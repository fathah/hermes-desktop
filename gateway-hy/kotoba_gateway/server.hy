;; Hermes API-compatible HTTP server for Kotoba desktop.
;;
;; Implements the subset of the upstream Hermes Agent api_server
;; (gateway/platforms/api_server.py) that the desktop speaks:
;;
;;   GET  /health                    unauthenticated liveness
;;   GET  /health/detailed           readiness for dashboard probing
;;   GET  /api/status                gateway status (dashboard contract)
;;   GET  /v1/capabilities           feature detection
;;   GET  /v1/models                 configured model
;;   POST /v1/chat/completions       OpenAI chat, streaming + non-streaming
;;   POST /v1/runs                   start a run (202 + run_id)
;;   GET  /v1/runs/{id}              run status
;;   GET  /v1/runs/{id}/events       run SSE event stream
;;   POST /v1/runs/{id}/stop         interrupt a run
;;
;; Mesh (decentralized operation, see identity/ledger/peers):
;;
;;   GET  /.well-known/kotoba-node   signed node manifest (unauthenticated)
;;   GET  /v1/peers                  verified peers (gossip)
;;   POST /v1/peers                  add a peer url / trust a did (local only)
;;   GET  /v1/blocks/{cid}           content-addressed ledger block
;;   GET  /v1/sessions/{id}/head     signed session head
;;   POST /v1/sessions/{id}/pull     replicate a session from a peer (local only)
;;   POST /v1/runs {"peer": did}     delegate a run to a peer (local only)
;;   GET  /v1/shard                  shard host status (with --shard)
;;   GET  /v1/placement              operator-signed placement manifest
;;   PUT  /v1/placement              adopt a newer manifest (local only)
;;
;; Paid orders (see orders.hy), with --order-provider:
;;
;;   POST /v1/orders                 register an order and its key hash (local only)
;;   GET  /v1/orders/{cid}/receipt   the signed receipt (local, or the order's key)
;;
;; Callers authenticate either as the local desktop (Bearer API_SERVER_KEY) or
;; as a trusted node (did:key-signed request headers).
;;
;; Every route is mirrored under /p/<profile>/ like upstream; one process
;; serves one profile, so the prefix is accepted and stripped.
;;
;; stdlib only (plus Hy) so it runs inside Hermes Agent's own venv.

(import argparse hmac json os queue re signal sys threading time uuid
        http.server [BaseHTTPRequestHandler ThreadingHTTPServer]
        urllib.parse [urlsplit])
(import kotoba_gateway [__version__]
        kotoba_gateway.backend [Callbacks make-backend]
        kotoba_gateway.identity [NodeIdentity verify-request]
        kotoba_gateway.ledger [BlockStore Ledger is-valid-cid]
        kotoba_gateway.orders [OrderDesk OrderError]
        kotoba_gateway.peers [PeerTable split-list]
        kotoba_gateway.runs [RunRegistry run-event TERMINAL-STATUSES]
        kotoba_gateway.placement [Placement]
        kotoba_gateway.shard [ProfileIndex ShardHost cost-report live-multiplexer
                              upstream-heartbeat upstream-tick upstream-secret-refresh]
        kotoba_gateway.fleet_secrets [lease-refresh-due load-node-config])

(setv MAX-BODY-BYTES (* 32 1024 1024)
      KEEPALIVE-SECONDS 15
      PROFILE-PREFIX-RE (re.compile r"^/p/[A-Za-z0-9_.-]+(/.*)$")
      RUN-PATH-RE (re.compile r"^/v1/runs/([A-Za-z0-9_-]+)(/events|/stop)?$")
      BLOCK-PATH-RE (re.compile r"^/v1/blocks/([a-z2-7]+)$")
      SESSION-PATH-RE (re.compile r"^/v1/sessions/([A-Za-z0-9_.:-]+)/(head|pull)$")
      ORDER-RECEIPT-RE (re.compile r"^/v1/orders/([a-z2-7]+)/receipt$")
      GOSSIP-SECONDS 120
      LOOPBACK #{"127.0.0.1" "::1" "localhost"})

(setv CAPABILITY-ENDPOINTS
      [["health" "GET" "/health"]
       ["models" "GET" "/v1/models"]
       ["chat_completions" "POST" "/v1/chat/completions"]
       ["runs" "POST" "/v1/runs"]
       ["run_status" "GET" "/v1/runs/{run_id}"]
       ["run_events" "GET" "/v1/runs/{run_id}/events"]
       ["run_stop" "POST" "/v1/runs/{run_id}/stop"]
       ["node_manifest" "GET" "/.well-known/kotoba-node"]
       ["peers" "GET" "/v1/peers"]
       ["blocks" "GET" "/v1/blocks/{cid}"]
       ["session_head" "GET" "/v1/sessions/{session_id}/head"]
       ["session_pull" "POST" "/v1/sessions/{session_id}/pull"]])

;; ─── Request parsing ─────────────────────────────────────────────────────

(defn content-text [content]
  "Flatten OpenAI content (string or part list) to text for history."
  (cond
    (isinstance content str) content
    (isinstance content list)
    (.join "\n" (lfor part content
                      :if (and (isinstance part dict) (= (.get part "type") "text"))
                      (or (.get part "text") "")))
    True (if (is content None) "" (str content))))

(defn split-chat-messages [messages]
  "OpenAI messages -> [instructions history user-message]."
  (setv system-parts []
        turns [])
  (for [m (or messages [])]
    (setv role (.get m "role"))
    (cond
      (in role #{"system" "developer"}) (.append system-parts (content-text (.get m "content")))
      (in role #{"user" "assistant"}) (.append turns m)))
  (when (or (not turns) (!= (.get (get turns -1) "role") "user"))
    (return [None [] None]))
  [(or (.join "\n\n" (filter None system-parts)) None)
   (lfor m (cut turns -1) {"role" (get m "role") "content" (content-text (.get m "content"))})
   (.get (get turns -1) "content")])

(defn normalize-history [history]
  (lfor m (or history [])
        :if (and (isinstance m dict) (in (.get m "role") #{"user" "assistant"}))
        {"role" (get m "role") "content" (content-text (.get m "content"))}))

;; ─── Gateway state ───────────────────────────────────────────────────────

(defclass Gateway []
  (defn __init__ [self backend api-key node ledger peers [public-url None]]
    (setv self.backend backend
          self.api-key (or api-key None)
          self.node node
          self.ledger ledger
          self.peers peers
          self.public-url public-url
          self.shard None
          self.placement None
          self.orders None
          self.runs (RunRegistry)
          self.started-at (time.time)
          self.model (.model-name backend)
          self.hermes-version (.version backend)))

  (defn authorize [self headers method path body]
    "\"local\" for the desktop's bearer key, a trusted peer's did for a valid
    node signature, or None. Without API_SERVER_KEY (loopback only) any local
    caller is the desktop."
    (setv header (or (.get headers "Authorization") ""))
    (cond
      (and self.api-key (.startswith header "Bearer "))
      (when (hmac.compare_digest (.encode header) (.encode (+ "Bearer " self.api-key)))
        "local")
      (.get headers "X-Kotoba-Node")
      (do (setv did (verify-request headers method path body))
          ;; Trusted: explicitly, or as a node named in the operator-signed
          ;; placement manifest.
          (when (and did (or (.is-trusted self.peers did)
                             (and self.placement (.is-member self.placement did))))
            did))
      (not self.api-key) "local"
      True None))

  (defn manifest [self]
    (.sign-document self.node
                    {"type" "kotoba.node" "did" self.node.did
                     "url" self.public-url
                     "api" "hermes" "implementation" f"kotoba-gateway/{__version__}"
                     "model" self.model "hermes_version" self.hermes-version
                     "features" ["runs" "chat_completions" "blocks" "session_heads"
                                 "run_delegation"]
                     "issued_at" (int (time.time))}))

  (defn record-turn [self run user-message output model]
    "Append a completed turn to the session's content-addressed chain."
    (when (and self.ledger run.session-id)
      (try
        (.append self.ledger run.session-id
                 {"run_id" run.run-id "model" model
                  "input" (if (isinstance user-message str) user-message (json.dumps user-message))
                  "output" output})
        (except [e Exception]
          (print f"[kotoba-gateway] ledger append failed: {e !r}" :file sys.stderr)))))

  (defn forward-turn [self run did body]
    "Delegate a run to peer `did` and relay its events into `run`."
    (setv rid run.run-id)
    (defn work []
      (setv run.status "running")
      (try
        (setv started (.call self.peers did "POST" "/v1/runs"
                             {#** body "session_id" run.session-id}))
        (setv run.remote [did (get started "run_id")])
        (for [event (.stream-events self.peers did (get started "run_id"))]
          (setv name (.get event "event" ""))
          (setv fields (dfor [k v] (.items event)
                             :if (not-in k #{"event" "run_id" "timestamp"}) k v))
          (cond
            (.startswith name "run.")
            (do (when (= name "run.completed") (.pull-session self did run.session-id))
                (.finish run (cut name 4 None) #** fields :node did)
                (return))
            True (.put run (run-event rid name #** fields :node did))))
        (.finish run "failed" :completed False :error f"peer {did} closed the run stream")
        (except [e Exception]
          (.finish run "failed" :completed False :error f"delegation to {did} failed: {e}"))))
    (.start (threading.Thread :target work :name f"kotoba-fwd-{rid}" :daemon True))
    run)

  (defn pull-session [self did session]
    "Replicate `session` from peer `did`; returns blocks fetched, or None."
    (when (not session) (return None))
    (try
      (setv head (.call self.peers did "GET" f"/v1/sessions/{session}/head"))
      (.adopt self.ledger head (fn [cid] (.fetch-block self.peers did cid)))
      (except [e Exception]
        (print f"[kotoba-gateway] pull {session} from {did} failed: {e}" :file sys.stderr)
        None)))

  (defn launch-turn [self run user-message history instructions model]
    "Run one agent turn on a worker thread, feeding `run`'s event queue."
    (setv rid run.run-id)
    (defn on-tool [event]
      (.put run (run-event rid (.pop event "event") #** event)))
    (setv cb (Callbacks
               :on_delta (fn [d] (.put run (run-event rid "message.delta" :delta d)))
               :on_reasoning (fn [t] (.put run (run-event rid "reasoning.available" :text t)))
               :on_tool on-tool
               :on_approval (fn [data]
                              (setv run.status "waiting_for_approval")
                              (.put run (run-event rid "approval.request"
                                                   :description (str (.get data "description" ""))
                                                   :pattern_key (.get data "pattern_key"))))
               :on_agent (fn [a] (setv run.agent a))))
    (defn work []
      (setv run.status "running")
      (try
        (setv result (.run-turn self.backend
                                :callbacks cb
                                :run_id rid
                                :session_id run.session-id
                                :user_message user-message
                                :history history
                                :instructions instructions
                                :model model))
        (cond
          (.get result "interrupted")
          (.finish run "cancelled" :completed False :interrupted True)
          (or (.get result "failed") (= (.get result "completed") False))
          (.finish run "failed" :completed False
                   :error (str (or (.get result "error") "agent run failed")))
          True
          (do
            (.record-turn self run user-message (or (.get result "final_response") "") model)
            (.finish run "completed" :completed True
                   :output (or (.get result "final_response") "")
                   :usage (.get result "usage" {})
                   :runtime {"model" (or (getattr run.agent "model" None) model self.model)
                             "provider" (or (getattr run.agent "provider" None) "")
                             "node" self.node.did})))
        (except [e Exception]
          (print f"[kotoba-gateway] run {rid} failed: {e !r}" :file sys.stderr)
          (.finish run "failed" :completed False :error (str e)))
        (finally
          (setv run.agent None))))
    (.start (threading.Thread :target work :name f"kotoba-run-{rid}" :daemon True))
    run))

;; ─── HTTP handler ────────────────────────────────────────────────────────

(defclass Handler [BaseHTTPRequestHandler]
  (setv protocol_version "HTTP/1.1"
        server_version f"kotoba-gateway/{__version__}"
        gateway None)

  (defn log_message [self fmt #* args]
    (when (os.environ.get "KOTOBA_GATEWAY_ACCESS_LOG")
      (.write sys.stderr (+ (% fmt args) "\n"))))

  ;; -- response helpers --

  (defn send-json [self status payload [headers None]]
    (setv body (.encode (json.dumps payload :ensure_ascii False) "utf-8"))
    (.send_response self status)
    (.send_header self "Content-Type" "application/json; charset=utf-8")
    (.send_header self "Content-Length" (str (len body)))
    (for [[k v] (.items (or headers {}))]
      (.send_header self k v))
    (.end_headers self)
    (.write self.wfile body))

  (defn send-error-json [self status message [code None]]
    (.send-json self status {"error" {"message" message
                                      "type" "invalid_request_error"
                                      "code" code}}))

  (defn start-sse [self [headers None]]
    (.send_response self 200)
    (.send_header self "Content-Type" "text/event-stream; charset=utf-8")
    (.send_header self "Cache-Control" "no-cache")
    (.send_header self "Connection" "close")
    (.send_header self "X-Accel-Buffering" "no")
    (for [[k v] (.items (or headers {}))]
      (.send_header self k v))
    (.end_headers self)
    (setv self.close_connection True))

  (defn sse [self data [event None]]
    (setv frame (+ (if event f"event: {event}\n" "")
                   "data: " (if (isinstance data str) data (json.dumps data :ensure_ascii False))
                   "\n\n"))
    (.write self.wfile (.encode frame "utf-8"))
    (.flush self.wfile))

  (defn read-raw-body [self]
    "Read the request body once (signatures cover it). False when too large."
    (setv n (int (or (.get self.headers "Content-Length") 0)))
    (when (> n MAX-BODY-BYTES)
      (return False))
    (setv self.raw-body (if (> n 0) (.read self.rfile n) b""))
    True)

  (defn read-json [self]
    (try
      (setv body (json.loads (.decode (or self.raw-body b"{}") "utf-8")))
      (except [Exception]
        (.send-error-json self 400 "Invalid JSON in request body." "invalid_json")
        (return None)))
    (if (isinstance body dict)
        body
        (do (.send-error-json self 400 "Request body must be a JSON object." "invalid_json")
            None)))

  ;; -- routing --

  (defn route-path [self]
    (setv path (. (urlsplit self.path) path)
          m (.match PROFILE-PREFIX-RE path))
    (if m (.group m 1) path))

  (defn dispatch [self method]
    (setv path (.route-path self)
          g self.gateway)
    (when (not (.read-raw-body self))
      (return (.send-error-json self 413 "Request body too large." "body_too_large")))
    (when (= path "/health")
      (return (.send-json self 200 {"status" "ok" "platform" "hermes-agent"
                                    "version" g.hermes-version
                                    "runtime" "kotoba-hy" "node" g.node.did})))
    (when (= path "/.well-known/kotoba-node")
      (return (.send-json self 200 (.manifest g))))
    (when (.order-route self method path)
      (return))
    (setv self.principal (.authorize g self.headers method self.path self.raw-body))
    (when (is self.principal None)
      (return (.send-error-json self 401 "Invalid API key or untrusted node." "invalid_api_key")))
    (setv run-match (.match RUN-PATH-RE path)
          block-match (.match BLOCK-PATH-RE path)
          session-match (.match SESSION-PATH-RE path))
    (cond
      (and (= method "GET") (= path "/v1/shard")) (.shard-status self)
      (and (= method "GET") (= path "/v1/placement")) (.placement-get self)
      (and (= method "PUT") (= path "/v1/placement")) (.placement-put self)
      (and (= method "POST") (= path "/v1/orders")) (.order-register self)
      (and (= method "GET") (.match ORDER-RECEIPT-RE path))
      (.order-receipt self (.group (.match ORDER-RECEIPT-RE path) 1))
      (and (= method "GET") (= path "/v1/peers")) (.peers-list self)
      (and (= method "POST") (= path "/v1/peers")) (.peers-add self)
      (and (= method "GET") block-match) (.block self (.group block-match 1))
      (and (= method "GET") session-match (= (.group session-match 2) "head"))
      (.session-head self (.group session-match 1))
      (and (= method "POST") session-match (= (.group session-match 2) "pull"))
      (.session-pull self (.group session-match 1))
      (and (= method "GET") (= path "/health/detailed")) (.health-detailed self)
      (and (= method "GET") (= path "/api/status")) (.api-status self)
      (and (= method "GET") (= path "/v1/capabilities")) (.capabilities self)
      (and (= method "GET") (= path "/v1/models")) (.models self)
      (and (= method "POST") (= path "/v1/chat/completions")) (.chat-completions self)
      (and (= method "POST") (= path "/v1/runs")) (.start-run self)
      (and run-match (= method "GET") (is (.group run-match 2) None))
      (.run-status self (.group run-match 1))
      (and run-match (= method "GET") (= (.group run-match 2) "/events"))
      (.run-events self (.group run-match 1))
      (and run-match (= method "POST") (= (.group run-match 2) "/stop"))
      (.run-stop self (.group run-match 1))
      True (.send-error-json self 404 f"No route for {method} {path}." "not_found")))

  (defn do_GET [self] (.dispatch self "GET"))
  (defn do_POST [self] (.dispatch self "POST"))
  (defn do_PUT [self] (.dispatch self "PUT"))

  (defn do_OPTIONS [self]
    (.send_response self 204)
    (.send_header self "Allow" "GET, POST, PUT, OPTIONS")
    (.send_header self "Content-Length" "0")
    (.end_headers self))

  ;; -- status surfaces --

  (defn health-detailed [self]
    (setv g self.gateway
          active (.active-count g.runs))
    (.send-json self 200
                {"status" "ok" "platform" "hermes-agent" "version" g.hermes-version
                 "runtime" "kotoba-hy" "gateway_state" "running"
                 "platforms" {"api_server" {"state" "connected"}}
                 "active_agents" active
                 "gateway_busy" (> active 0) "gateway_drainable" True
                 "exit_reason" None "updated_at" None "pid" (os.getpid)}))

  (defn api-status [self]
    (setv g self.gateway)
    (.send-json self 200
                {"version" g.hermes-version "gateway_running" True
                 "gateway_state" "running" "gateway_pid" (os.getpid)
                 "active_agents" (.active-count g.runs)
                 "gateway_platforms" {"api_server" {"state" "connected"}}
                 "runtime" "kotoba-hy"}))

  (defn capabilities [self]
    (setv g self.gateway)
    (.send-json self 200
                {"object" "hermes.api_server.capabilities"
                 "platform" "hermes-agent"
                 "model" g.model
                 "auth" {"type" "bearer" "required" (bool g.api-key)}
                 "runtime" {"mode" "server_agent" "tool_execution" "server"
                            "split_runtime" False
                            "implementation" f"kotoba-gateway/{__version__} (hy)"
                            "backend" g.backend.name}
                 "features" {"chat_completions" True "chat_completions_streaming" True
                             "responses_api" False "responses_streaming" False
                             "run_submission" True "run_events" True "run_stop" True
                             "session_continuity_header" "X-Hermes-Session-Id"
                             "cors" False
                             "orders" (is-not g.orders None)
                             "mesh" {"node" g.node.did
                                     "peers" (len (.listing g.peers))
                                     "content_addressed_sessions" True
                                     "run_delegation" True}}
                 "endpoints" (dfor [name m p] CAPABILITY-ENDPOINTS
                                   name {"method" m "path" p})}))

  (defn models [self]
    (setv model self.gateway.model)
    (.send-json self 200
                {"object" "list"
                 "data" [{"id" model "object" "model" "created" (int (time.time))
                          "owned_by" "hermes" "permission" [] "root" model "parent" None}]}))

  ;; -- runs --

  (defn start-run [self]
    (setv body (.read-json self))
    (when (is body None) (return))
    (setv user-input (.get body "input"))
    (when (not user-input)
      (return (.send-error-json self 400 "`input` is required." "missing_input")))
    (setv session-id (or (.get body "session_id")
                         (.get self.headers "X-Hermes-Session-Id")
                         None)
          g self.gateway
          run (.create g.runs session-id))
    (when (is session-id None)
      (setv run.session-id run.run-id))
    (setv peer (or (.get body "peer") (.get self.headers "X-Kotoba-Peer")))
    (cond
      peer
      (do (when (!= self.principal "local")
            ;; One hop only: a delegated run never re-delegates.
            (return (.send-error-json self 403 "Only the local desktop may delegate runs."
                                      "delegation_forbidden")))
          (when (is (.get-peer g.peers peer) None)
            (return (.send-error-json self 404 f"Unknown peer {peer}." "peer_not_found")))
          (.forward-turn g run peer (dfor [k v] (.items body) :if (!= k "peer") k v)))
      True
      (.launch-turn g run user-input
                    (or (normalize-history (.get body "conversation_history"))
                        (.history g.ledger run.session-id))
                    (.get body "instructions")
                    (.get body "model")))
    (.send-json self 202 {"object" "hermes.run" "run_id" run.run-id
                          "status" "queued" "session_id" run.session-id}
                {"X-Hermes-Session-Id" run.session-id}))

  (defn run-status [self run-id]
    (setv run (.get-run self.gateway.runs run-id))
    (if run
        (.send-json self 200 (.snapshot run))
        (.send-error-json self 404 f"Run {run-id} not found." "run_not_found")))

  (defn run-events [self run-id]
    (setv run (.get-run self.gateway.runs run-id))
    (when (is run None)
      (return (.send-error-json self 404 f"Run {run-id} not found." "run_not_found")))
    (.start-sse self)
    (try
      (while True
        (try
          (setv event (.get run.events :timeout KEEPALIVE-SECONDS))
          (except [queue.Empty]
            (.write self.wfile b": keepalive\n\n")
            (.flush self.wfile)
            (continue)))
        (when (is event None)
          (break))
        (.sse self event))
      (except [[BrokenPipeError ConnectionResetError]]
        ;; Client went away: stop the agent rather than burn tokens unseen.
        (.stop self.gateway.runs run-id))))

  (defn run-stop [self run-id]
    (setv run (.stop self.gateway.runs run-id))
    (when (and run (getattr run "remote" None))
      (setv [did remote-id] run.remote)
      (try (.call self.gateway.peers did "POST" f"/v1/runs/{remote-id}/stop" {})
           (except [Exception])))
    (if run
        (.send-json self 200 {"object" "hermes.run" "run_id" run-id
                              "status" (if (in run.status TERMINAL-STATUSES) run.status "stopping")})
        (.send-error-json self 404 f"Run {run-id} not found." "run_not_found")))

  ;; -- mesh --

  (defn local-only [self]
    (when (!= self.principal "local")
      (.send-error-json self 403 "Only the local desktop may change the peer table."
                        "local_only")
      (return True))
    False)

  (defn shard-status [self]
    (setv shard self.gateway.shard)
    (if shard
        (.send-json self 200 {#** (.status shard)
                              "placement" (when self.gateway.placement
                                            (.status self.gateway.placement))})
        (.send-error-json self 404 "Shard mode is off (start with --shard observe|run)." "shard_off")))

  (defn placement-get [self]
    (setv pl self.gateway.placement)
    (cond
      (is pl None) (.send-error-json self 404 "Placement is off (start with --operator-did)." "placement_off")
      (is pl.manifest None) (.send-error-json self 404 "No placement manifest adopted yet." "no_manifest")
      True (.send-json self 200 pl.manifest)))

  (defn placement-put [self]
    (when (.local-only self) (return))
    (setv pl self.gateway.placement)
    (when (is pl None)
      (return (.send-error-json self 404 "Placement is off (start with --operator-did)." "placement_off")))
    (setv doc (.read-json self))
    (when (is doc None) (return))
    (if (.adopt pl doc)
        (.send-json self 200 {"adopted" (get doc "version") "allowed" (len (.allowed-set pl))})
        (.send-error-json self 409 "Not adopted: needs the operator's signature and a higher version."
                          "manifest_rejected")))

  (defn peers-list [self]
    (setv g self.gateway)
    (.send-json self 200 {"object" "list" "node" g.node.did "peers" (.listing g.peers)}))

  (defn peers-add [self]
    (when (.local-only self) (return))
    (setv body (.read-json self))
    (when (is body None) (return))
    (setv g self.gateway
          out {})
    (when (.get body "url")
      (setv did (.add-url g.peers (get body "url")))
      (when (is did None)
        (return (.send-error-json self 422 "No verifiable Kotoba node at that url."
                                  "peer_unverified")))
      (setv (get out "did") did))
    (when (.get body "trust")
      (.trust g.peers (get body "trust"))
      (setv (get out "trusted") (get body "trust")))
    (.save g.peers)
    (.send-json self 200 out))

  (defn block [self cid]
    (setv data (.get-bytes self.gateway.ledger.blocks cid))
    (when (is data None)
      (return (.send-error-json self 404 f"Block {cid} not found." "block_not_found")))
    (.send_response self 200)
    (.send_header self "Content-Type" "application/json")
    (.send_header self "Content-Length" (str (len data)))
    (.send_header self "ETag" f"\"{cid}\"")
    (.send_header self "Cache-Control" "public, max-age=31536000, immutable")
    (.end_headers self)
    (.write self.wfile data))

  (defn session-head [self session]
    (setv head (.head self.gateway.ledger session))
    (if head
        (.send-json self 200 head)
        (.send-error-json self 404 f"Session {session} has no head." "session_not_found")))

  (defn session-pull [self session]
    (when (.local-only self) (return))
    (setv body (.read-json self))
    (when (is body None) (return))
    (setv fetched (.pull-session self.gateway (.get body "peer") session))
    (if (is fetched None)
        (.send-error-json self 502 "Could not replicate the session from that peer."
                          "pull_failed")
        (.send-json self 200 {"session" session "fetched" fetched
                              "head" (.head self.gateway.ledger session)})))

  ;; -- chat completions --

  ;; -- paid orders --

  (defn order-route [self method path]
    "Serve a request made with an order's key. False leaves it to normal auth,
    so an order's key opens nothing else on this node."
    (setv desk self.gateway.orders
          header (or (.get self.headers "Authorization") ""))
    (when (or (is desk None) (not (.startswith header "Bearer ")))
      (return False))
    (setv key (cut header 7 None)
          found (.lookup desk key))
    (when (is found None)
      (return False))
    (setv [cid order] found
          receipt-match (.match ORDER-RECEIPT-RE path))
    (cond
      (and (= method "POST") (= path "/v1/chat/completions"))
      (do (.order-chat self desk cid order key) True)
      (and (= method "GET") receipt-match (= (.group receipt-match 1) cid))
      (do (.order-receipt self cid) True)
      True False))

  (defn order-register [self]
    (when (!= self.principal "local")
      (return (.send-error-json self 403 "Only the local operator may register orders." "local_only")))
    (setv desk self.gateway.orders)
    (when (is desk None)
      (return (.send-error-json self 404 "Orders are not enabled on this node." "not_found")))
    (setv body (.read-json self))
    (when (is body None) (return))
    (try
      (.send-json self 201 {"order" (.register desk (.get body "order") (.get body "key_sha256"))})
      (except [e OrderError]
        (.send-error-json self e.status e.message e.code))))

  (defn order-receipt [self cid]
    (setv desk self.gateway.orders)
    (when (is desk None)
      (return (.send-error-json self 404 "Orders are not enabled on this node." "not_found")))
    (try
      (.send-json self 200 (.receipt desk cid))
      (except [e OrderError]
        (.send-error-json self e.status e.message e.code))))

  (defn order-chat [self desk cid order key]
    (setv body (.read-json self))
    (when (is body None) (return))
    (try
      (setv served (.serve desk cid order key self.raw-body body))
      (except [e OrderError]
        (return (.send-error-json self e.status e.message e.code))))
    (setv headers {"X-Awai-Order" cid "X-Awai-Receipt" (get served "receipt-cid")})
    (if (.get body "stream")
        (.order-stream self served headers)
        (.send-json self 200 (get served "reply") headers)))

  (defn order-stream [self served headers]
    "The finished result as OpenAI chunks: a client that only streams can read it."
    (setv reply (get served "reply")
          message (dict (get served "message"))
          frame {"id" (.get reply "id") "object" "chat.completion.chunk"
                 "created" (.get reply "created") "model" (.get reply "model")})
    (when (.get message "tool_calls")
      (setv (get message "tool_calls") (lfor [i call] (enumerate (get message "tool_calls"))
                                             {#** call "index" i})))
    (.start-sse self headers)
    (try
      (.sse self {#** frame "choices" [{"index" 0 "delta" message "finish_reason" None}]})
      (.sse self {#** frame
                  "choices" [{"index" 0 "delta" {}
                              "finish_reason" (.get (get (get reply "choices") 0) "finish_reason" "stop")}]
                  "usage" (get reply "usage")})
      (.sse self "[DONE]")
      (except [[BrokenPipeError ConnectionResetError]] None)))

  (defn chat-completions [self]
    (setv body (.read-json self))
    (when (is body None) (return))
    (setv [instructions history user-message] (split-chat-messages (.get body "messages")))
    (when (is user-message None)
      (return (.send-error-json self 400 "The last message must be a user message."
                                "invalid_messages")))
    (setv g self.gateway
          session-id (or (.get self.headers "X-Hermes-Session-Id")
                         (.get body "session_id")
                         f"api-{(cut (. (uuid.uuid4) hex) 16)}")
          run (.create g.runs session-id)
          model (or (.get body "model") g.model))
    (.launch-turn g run user-message history instructions (.get body "model"))
    (if (.get body "stream")
        (.stream-chat self run model)
        (.blocking-chat self run model)))

  (defn chunk [self run model delta [finish None] [usage None]]
    (setv payload {"id" (+ "chatcmpl-" run.run-id) "object" "chat.completion.chunk"
                   "created" (int run.created-at) "model" model
                   "choices" [{"index" 0 "delta" delta "finish_reason" finish}]})
    (when usage (setv (get payload "usage") usage))
    payload)

  (defn chat-usage [self usage]
    (setv usage (or usage {}))
    {"prompt_tokens" (.get usage "input_tokens" 0)
     "completion_tokens" (.get usage "output_tokens" 0)
     "total_tokens" (.get usage "total_tokens" 0)})

  (defn stream-chat [self run model]
    (.start-sse self {"X-Hermes-Session-Id" run.session-id})
    (setv streamed False)
    (try
      (.sse self (.chunk self run model {"role" "assistant"}))
      (while True
        (try
          (setv event (.get run.events :timeout KEEPALIVE-SECONDS))
          (except [queue.Empty]
            (.write self.wfile b": keepalive\n\n")
            (.flush self.wfile)
            (continue)))
        (when (is event None) (break))
        (setv name (get event "event"))
        (cond
          (= name "message.delta")
          (do (setv streamed True)
              (.sse self (.chunk self run model {"content" (get event "delta")})))
          (= name "reasoning.available")
          (.sse self (.chunk self run model {"reasoning_content" (get event "text")}))
          (in name #{"tool.started" "tool.completed"})
          (.sse self {"tool" (.get event "tool")
                      "label" (or (.get event "preview") (.get event "tool"))
                      "toolCallId" (+ run.run-id ":" (str (.get event "tool")))
                      "status" (if (= name "tool.started") "running"
                                   (if (.get event "error") "failed" "completed"))}
                :event "hermes.tool.progress")
          (= name "approval.request")
          (.sse self event :event "approval.request")
          (= name "run.completed")
          (do (when (and (not streamed) (.get event "output"))
                (.sse self (.chunk self run model {"content" (get event "output")})))
              (.sse self (.chunk self run model {} "stop"
                                 (.chat-usage self (.get event "usage")))))
          (= name "run.failed")
          (.sse self {"error" {"message" (.get event "error") "type" "server_error"}})
          (= name "run.cancelled")
          (.sse self (.chunk self run model {} "stop"))))
      (.sse self "[DONE]")
      (except [[BrokenPipeError ConnectionResetError]]
        (.stop self.gateway.runs run.run-id))))

  (defn blocking-chat [self run model]
    (while True
      (setv event (.get run.events))
      (when (is event None) (break)))
    (if (= run.status "failed")
        (.send-json self 500 {"error" {"message" (or run.error "agent run failed")
                                       "type" "server_error"}}
                    {"X-Hermes-Session-Id" run.session-id})
        (.send-json self 200
                    {"id" (+ "chatcmpl-" run.run-id) "object" "chat.completion"
                     "created" (int run.created-at) "model" model
                     "choices" [{"index" 0
                                 "message" {"role" "assistant" "content" (or run.output "")}
                                 "finish_reason" "stop"}]
                     "usage" {"prompt_tokens" 0 "completion_tokens" 0 "total_tokens" 0}}
                    {"X-Hermes-Session-Id" run.session-id}))))

;; ─── Process lifecycle ───────────────────────────────────────────────────

(defn read-env-file [path]
  "Minimal KEY=VALUE reader for HERMES_HOME/.env (used only for API_SERVER_KEY)."
  (setv out {})
  (when (os.path.isfile path)
    (with [f (open path :encoding "utf-8")]
      (for [line f]
        (setv line (.strip line))
        (when (and line (not (.startswith line "#")) (in "=" line))
          (setv [k v] (.split line "=" 1)
                (get out (.strip k)) (.strip (.strip v) "\"'"))))))
  out)

(defn write-pid-file [path]
  (when path
    (os.makedirs (os.path.dirname (os.path.abspath path)) :exist_ok True)
    (with [f (open path "w" :encoding "utf-8")]
      (.write f (json.dumps {"pid" (os.getpid) "kind" "kotoba-gateway"
                             "runtime" "hy" "started_at" (time.time)})))))

(defn remove-pid-file [path]
  (when (and path (os.path.isfile path))
    (try (os.remove path) (except [OSError]))))

(defn parse-args [argv]
  (setv p (argparse.ArgumentParser :prog "kotoba-gateway"
                                   :description "Hermes API-compatible gateway (Hy)."))
  (.add_argument p "--host" :default (os.environ.get "API_SERVER_HOST" "127.0.0.1"))
  (.add_argument p "--port" :type int :default (int (os.environ.get "API_SERVER_PORT" "8642")))
  (.add_argument p "--backend" :default (os.environ.get "KOTOBA_GATEWAY_BACKEND" "hermes")
                 :choices ["hermes" "echo"])
  (.add_argument p "--pid-file" :default (os.environ.get "KOTOBA_GATEWAY_PID_FILE"))
  ;; Paid orders (network-awai-apex ADR 0027). All of them, or none.
  (.add_argument p "--order-provider" :default (os.environ.get "KOTOBA_ORDER_PROVIDER")
                 :help "the provider did:key that orders must name; turns on orders")
  (.add_argument p "--order-upstream" :default (os.environ.get "KOTOBA_ORDER_UPSTREAM")
                 :help "the local llama.cpp server")
  (.add_argument p "--order-engine-file" :default (os.environ.get "KOTOBA_ORDER_ENGINE_FILE"))
  (.add_argument p "--order-engine-version" :default (os.environ.get "KOTOBA_ORDER_ENGINE_VERSION"))
  (.add_argument p "--order-model-file" :default (os.environ.get "KOTOBA_ORDER_MODEL_FILE"))
  (.add_argument p "--order-model-revision" :default (os.environ.get "KOTOBA_ORDER_MODEL_REVISION"))
  ;; Shard host (profile distribution phase 2): tick only due profiles.
  (.add_argument p "--shard" :default (os.environ.get "KOTOBA_SHARD" "off")
                 :choices ["off" "observe" "run"])
  (.add_argument p "--max-turns" :type int
                 :default (int (os.environ.get "KOTOBA_SHARD_MAX_TURNS" (max 1 (// (or (os.cpu_count) 2) 2)))))
  (.add_argument p "--reserved-cron-profile" :action "append" :default []
                 :help "share one extra bounded tick slot for named critical profiles")
  (.add_argument p "--shard-rescan-seconds" :type float :default 60)
  (.add_argument p "--shard-force" :action "store_true"
                 :help "run mode even while an upstream multiplexer is live (jobs may run twice)")
  (.add_argument p "--shard-report" :action "store_true"
                 :help "print the per-profile cost report as JSON and exit")
  ;; Placement (phase 3): tick only profiles the operator-signed manifest
  ;; places on this node. No central store: manifests travel over the mesh.
  (.add_argument p "--operator-did" :default (os.environ.get "KOTOBA_OPERATOR_DID")
                 :help "did:key whose signature makes a placement manifest valid")
  (.add_argument p "--placement-interval" :type float :default 60)
  (.add_argument p "--also-listen" :action "append" :default []
                 :help "extra HOST:PORT to serve on (e.g. the tailnet address)")
  (.add_argument p "--nodes" :type int :default 9)
  (.add_argument p "--turns-per-node" :type int :default 5)
  (.parse_args p argv))

(setv NODE-STATE-FILES ["kotoba-node.key" "kotoba-heads.json" "kotoba-peers.json" "kotoba-blocks"])

(defn lease-refresh-hook []
  "before-tick hook for nodes whose node.json asks for GitHub leases; None
  elsewhere (no kagi agent, or no `github_lease`), so nothing changes there."
  (try
    (when (.get (load-node-config) "github_lease")
      (upstream-secret-refresh lease-refresh-due))
    (except [[OSError ValueError]] None)))

(defn default-state-dir [hermes-home]
  "Node identity, ledger and peers live under ~/.kotoba/homes/<id>, outside
  the Hermes-managed home: on 2026-10-09 the node key written to HERMES_HOME
  had disappeared overnight and the node came back with a new did:key.
  `<id>` is derived from the home's real path, so each profile home keeps
  its own node. Files found in the old location are moved over once."
  (import hashlib shutil)
  (setv real (os.path.realpath hermes-home)
        state (os.path.join (os.path.expanduser (os.environ.get "KOTOBA_STATE_ROOT" "~/.kotoba/homes"))
                            (cut (.hexdigest (hashlib.sha256 (.encode real "utf-8"))) 16)))
  (os.makedirs state :mode 0o700 :exist_ok True)
  (with [f (open (os.path.join state "HOME") "w" :encoding "utf-8")]
    (.write f (+ real "\n")))
  (for [name NODE-STATE-FILES]
    (setv old (os.path.join hermes-home name)
          new (os.path.join state name))
    (when (and (os.path.exists old) (not (os.path.exists new)))
      (shutil.move old new)
      (print f"[kotoba-gateway] moved {old} -> {new}" :file sys.stderr)))
  state)

(defn make-server [host port backend api-key [state-dir None] [seeds None] [trusted None]
                   [public-url None]]
  "Build the HTTP server. `state-dir` holds the node key, blocks, heads and
  peer table (the profile's HERMES_HOME in production)."
  (setv state (or state-dir (default-state-dir (os.path.expanduser "~/.hermes")))
        node (NodeIdentity.load-or-create (os.path.join state "kotoba-node.key"))
        ledger (Ledger (BlockStore (os.path.join state "kotoba-blocks"))
                       (os.path.join state "kotoba-heads.json") node)
        peers (PeerTable node (os.path.join state "kotoba-peers.json") seeds trusted)
        gateway (Gateway backend api-key node ledger peers public-url)
        handler (type "BoundHandler" #(Handler) {"gateway" gateway})
        server (ThreadingHTTPServer #(host port) handler))
  (setv server.daemon_threads True)
  (when (not public-url)
    ;; The bound port (port 0 picks one). Peers on other hosts need
    ;; KOTOBA_PUBLIC_URL, since a loopback address only works on this machine.
    (setv gateway.public-url f"http://{host}:{(get server.server_address 1)}"))
  [server gateway])

(defn main [[argv None]]
  (setv args (parse-args argv)
        home (os.path.expanduser (os.environ.get "HERMES_HOME" "~/.hermes"))
        api-key (or (os.environ.get "API_SERVER_KEY")
                    (.get (read-env-file (os.path.join home ".env")) "API_SERVER_KEY")))
  (when args.shard-report
    (print (json.dumps (cost-report home :nodes args.nodes :turns-per-node args.turns-per-node)
                       :indent 2 :ensure_ascii False))
    (return 0))
  (when (and (= args.shard "run") (not args.shard-force))
    (setv mux (live-multiplexer home))
    (when mux
      (print f"[kotoba-gateway] Refusing --shard run: upstream multiplexer pid {mux} is live and ticks the same profiles. Stop it first, or use --shard observe."
             :file sys.stderr)
      (return 78)))
  (setv bind-hosts (+ [args.host] (lfor spec args.also-listen (get (.rsplit spec ":" 1) 0))))
  (when (and (not api-key) (any (gfor h bind-hosts (not-in h LOOPBACK))))
    (print "[kotoba-gateway] Refusing to bind a non-loopback host (--host or --also-listen) without API_SERVER_KEY."
           :file sys.stderr)
    (return 78))
  (setv backend (make-backend args.backend)
        [server gateway] (make-server args.host args.port backend api-key
                                      :state-dir (default-state-dir home)
                                      :seeds (split-list (os.environ.get "KOTOBA_PEERS"))
                                      :trusted (split-list (os.environ.get "KOTOBA_TRUSTED_PEERS"))
                                      :public-url (os.environ.get "KOTOBA_PUBLIC_URL")))
  (when args.order-provider
    (setv settings [args.order-upstream args.order-engine-file args.order-engine-version
                    args.order-model-file args.order-model-revision])
    (when (not (all settings))
      (print "[kotoba-gateway] Refusing orders: --order-provider needs the upstream, engine and model settings."
             :file sys.stderr)
      (return 78))
    (try
      (setv gateway.orders (OrderDesk gateway.node gateway.ledger
                                      (os.path.join (default-state-dir home) "kotoba-orders")
                                      args.order-provider args.order-upstream
                                      args.order-engine-file args.order-engine-version
                                      args.order-model-file args.order-model-revision))
      (except [e [ValueError OSError]]
        (print f"[kotoba-gateway] Refusing orders: {e}" :file sys.stderr)
        (return 78)))
    (print (+ f"[kotoba-gateway] orders on: provider={args.order-provider} model="
              (get gateway.orders.model "digest"))
           :file sys.stderr :flush True))
  (.start-gossip gateway.peers (int (os.environ.get "KOTOBA_GOSSIP_SECONDS" GOSSIP-SECONDS)))
  (setv placement None)
  (when args.operator-did
    (setv placement (Placement gateway.node args.operator-did
                               (os.path.join (default-state-dir home) "placement.json")
                               :interval args.placement-interval)
          gateway.placement placement))
  (when (!= args.shard "off")
    (setv gateway.shard (ShardHost (ProfileIndex home)
                                   (if (= args.shard "run") (upstream-tick) None)
                                   :mode args.shard :max-turns args.max-turns
                                   :reserved-profiles args.reserved_cron_profile
                                   :rescan-seconds args.shard-rescan-seconds
                                   :heartbeat-fn (when (= args.shard "run") (upstream-heartbeat))
                                   :allow (when placement (fn [name] (.allows placement name)))
                                   :before-tick (when (= args.shard "run") (lease-refresh-hook))))
    (when placement
      (setv placement.on-change (fn [_] (.reapply-leases gateway.shard))))
    (.start gateway.shard)
    (print f"[kotoba-gateway] shard {args.shard}: max-turns={args.max-turns} rescan={args.shard-rescan-seconds}s"
           :file sys.stderr :flush True))
  (when placement
    (print f"[kotoba-gateway] placement: operator={args.operator-did} version={(.version placement)} allowed={(len (.allowed-set placement))}"
           :file sys.stderr :flush True)
    (.start placement))
  ;; Extra listeners (same handler), e.g. the tailnet address for peers.
  ;; Retain each server so SIGTERM can stop every accept loop before draining.
  (setv extra-servers [])
  (for [spec args.also-listen]
    (setv [h pt] (.rsplit spec ":" 1)
          extra (ThreadingHTTPServer #(h (int pt)) server.RequestHandlerClass))
    (setv extra.daemon_threads True)
    (.append extra-servers extra)
    (.start (threading.Thread :target extra.serve_forever :daemon True))
    (print f"[kotoba-gateway] also listening on http://{h}:{pt}" :file sys.stderr :flush True))
  (write-pid-file args.pid-file)
  (defn shutdown [signum frame]
    (.start (threading.Thread :target server.shutdown :daemon True)))
  (signal.signal signal.SIGTERM shutdown)
  (signal.signal signal.SIGINT shutdown)
  (print f"[kotoba-gateway] Hermes API on http://{args.host}:{args.port} backend={backend.name} model={gateway.model} node={gateway.node.did}"
         :file sys.stderr :flush True)
  (try
    (.serve_forever server)
    (finally
      ;; Stop every listener first so no new request or scheduler work enters.
      (for [extra extra-servers]
        (.shutdown extra)
        (.server_close extra))
      (.server_close server)
      ;; Drain active ticks; terminating a non-daemon worker mid-effect could
      ;; replay a partially completed cron job after launchd restarts the host.
      (when gateway.shard (.close gateway.shard :wait True))
      (remove-pid-file args.pid-file)
      (sys.stdout.flush) (sys.stderr.flush)))
  0)
