;; Paid orders over real HTTP, against a stand-in for llama.cpp that counts its
;; calls. The stand-in shows the gateway's own behaviour; it is not evidence
;; that a real model served an order.

(import hashlib hmac json os tempfile threading time unittest
        http.server [BaseHTTPRequestHandler ThreadingHTTPServer]
        urllib.request [Request urlopen]
        urllib.error [HTTPError])
(import kotoba_gateway.backend [EchoBackend]
        kotoba_gateway.identity [canonical is-signed]
        kotoba_gateway.ledger [cid-of]
        kotoba_gateway.orders [OrderDesk hash-file key-hash]
        kotoba_gateway.server [make-server])

(setv API-KEY "orders-api-key-0123456789"
      PROVIDER "did:key:zProviderOperator"
      SECRET-PROMPT "the-secret-prompt-text"
      SECRET-OUTPUT "the-secret-output-text")

(defclass FakeEngine [BaseHTTPRequestHandler]
  (setv state None)

  (defn log-message [self #* args] None)

  (defn reply [self status body]
    (setv data (.encode (json.dumps body) "utf-8"))
    (.send_response self status)
    (.send_header self "Content-Type" "application/json")
    (.send_header self "Content-Length" (str (len data)))
    (.end_headers self)
    (.write self.wfile data))

  (defn do_GET [self]
    (.reply self 200 {"model_path" (get self.state "model-path")}))

  (defn do_POST [self]
    (setv n (int (or (.get self.headers "Content-Length") 0))
          body (json.loads (.read self.rfile n))
          state self.state)
    (with [(get state "lock")]
      (+= (get state "calls") 1)
      (setv (get state "last") body))
    (when (get state "redirect")
      (.send_response self 307)
      (.send_header self "Location" (get state "redirect"))
      (.send_header self "Content-Length" "0")
      (.end_headers self)
      (return))
    (when (get state "fail")
      (return (.reply self 500 {"error" "broken"})))
    (time.sleep (get state "delay"))
    (setv usage (if (get state "no-usage") {}
                    {"prompt_tokens" 7 "completion_tokens" 11 "total_tokens" 18}))
    (.reply self 200 {"id" "cmpl-1" "object" "chat.completion" "created" 1 "model" "m"
                      "choices" [{"index" 0 "finish_reason" "stop"
                                  "message" {"role" "assistant" "content" SECRET-OUTPUT}}]
                      "usage" usage})))

(defclass Orders [unittest.TestCase]
  (defn setUp [self]
    (setv self.dir (tempfile.TemporaryDirectory)
          self.model-file (os.path.join self.dir.name "model.gguf")
          self.engine-file (os.path.join self.dir.name "llama-server"))
    (for [[path text] [[self.model-file "model bytes"] [self.engine-file "engine bytes"]]]
      (with [f (open path "w")] (.write f text)))
    (setv self.engine-state {"calls" 0 "last" None "fail" False "no-usage" False "delay" 0
                             "redirect" None "lock" (threading.Lock)
                             "model-path" self.model-file}
          self.engine (ThreadingHTTPServer #("127.0.0.1" 0)
                                           (type "Engine" #(FakeEngine) {"state" self.engine-state}))
          self.upstream f"http://127.0.0.1:{(get self.engine.server_address 1)}"
          [self.server self.gateway] (make-server "127.0.0.1" 0 (EchoBackend) API-KEY
                                                  :state-dir (os.path.join self.dir.name "state"))
          self.state-dir (os.path.join self.dir.name "state")
          self.base f"http://127.0.0.1:{(get self.server.server_address 1)}"
          self.gateway.orders (OrderDesk self.gateway.node self.gateway.ledger
                                         (os.path.join self.state-dir "kotoba-orders")
                                         PROVIDER self.upstream
                                         self.engine-file "0.7.0"
                                         self.model-file "rev-1")
          self.serial 0)
    (.start (threading.Thread :target self.engine.serve_forever :daemon True))
    (.start (threading.Thread :target self.server.serve_forever :daemon True)))

  (defn tearDown [self]
    (.shutdown self.server)
    (.server_close self.server)
    (.shutdown self.engine)
    (.server_close self.engine)
    (.cleanup self.dir))

  (defn order [self #** changes]
    (+= self.serial 1)
    {"kind" "awai.order/1" "work-kind" "compute"
     "buyer" "did:key:zBuyer" "provider" PROVIDER "node" self.gateway.node.did
     "asset" "native/engi/EN" "amount" "1" "value-class" "devnet"
     "model" {"revision" "rev-1" "digest" (hash-file self.model-file)}
     "max-tokens" 16 "expires-at" (+ (int (time.time)) 600)
     "data-categories" ["prompt"] "policy" (+ "sha256:" (* "a" 64))
     "demand" "owner-internal" "nonce" f"n-{self.serial}"
     #** (dfor [k v] (.items changes) (.replace k "_" "-") v)})

  (defn call [self method path [body None] [key API-KEY]]
    "[status headers json] for any answer, including refusals."
    (setv req (Request (+ self.base path) :method method
                       :data (when (is-not body None) (.encode (json.dumps body) "utf-8"))))
    (.add_header req "Content-Type" "application/json")
    (when key (.add_header req "Authorization" (+ "Bearer " key)))
    (try
      (with [res (urlopen req :timeout 10)]
        [res.status (dict res.headers) (json.loads (.read res))])
      (except [e HTTPError]
        [e.code (dict e.headers) (json.loads (.read e))])))

  (defn register [self order key]
    (.call self "POST" "/v1/orders" {"order" order "key_sha256" (key-hash key)}))

  (defn registered [self key #** changes]
    (setv order (.order self #** changes)
          [status _ body] (.register self order key))
    (.assertEqual self status 201 body)
    [(get body "order") order])

  (defn chat [self key [messages None] #** extra]
    (.call self "POST" "/v1/chat/completions"
           {"model" "m" "messages" (or messages [{"role" "user" "content" SECRET-PROMPT}]) #** extra}
           :key key))

  (defn error-code [self answer]
    (get (get (get answer 2) "error") "code"))

  ;; @lat: [[gateway-hy#Tests#An order gets one signed receipt]]
  (defn test-an-order-gets-one-signed-receipt [self]
    (setv key "order-key-1"
          [cid order] (.registered self key)
          body {"model" "m" "messages" [{"role" "user" "content" SECRET-PROMPT}]}
          raw (.encode (json.dumps body) "utf-8")
          [status headers reply] (.call self "POST" "/v1/chat/completions" body :key key))
    (.assertEqual self status 200)
    (.assertEqual self (get headers "X-Awai-Order") cid)
    (setv [rstatus _ receipt] (.call self "GET" f"/v1/orders/{cid}/receipt" :key key))
    (.assertEqual self rstatus 200)
    (.assertTrue self (is-signed receipt))
    (.assertEqual self (get headers "X-Awai-Receipt") (cid-of (canonical receipt)))
    (.assertEqual self (cid-of (canonical order)) cid)
    (.assertEqual self (get receipt "kind") "awai.work-receipt/1")
    (.assertEqual self (get receipt "order") cid)
    (.assertEqual self (get receipt "signer") self.gateway.node.did)
    (.assertEqual self (get receipt "provider") PROVIDER)
    (.assertEqual self (get (get receipt "model") "digest") (hash-file self.model-file))
    (.assertEqual self (get (get receipt "engine") "digest") (hash-file self.engine-file))
    (.assertEqual self (get receipt "output")
                  (cid-of (canonical (get (get (get reply "choices") 0) "message"))))
    (.assertEqual self (get receipt "input")
                  (+ "hmac-sha256:" (.hexdigest (hmac.new (.encode key) raw hashlib.sha256))))
    (setv measured (get receipt "measured"))
    (.assertEqual self (get measured "prompt-tokens") 7)
    (.assertEqual self (get measured "completion-tokens") 11)
    (.assertEqual self (set (.keys receipt))
                  #{"kind" "work-kind" "order" "provider" "node" "input" "output" "engine" "model"
                    "measured" "ledger-head" "demand" "nonce" "signer" "signature"}))

  ;; @lat: [[gateway-hy#Tests#Orders keep no prompt or output]]
  (defn test-orders-keep-no-prompt-or-output [self]
    (setv key "order-key-2"
          [cid _] (.registered self key))
    (.chat self key)
    (setv found [])
    (for [[folder _ names] (os.walk self.state-dir)
          name names]
      (setv path (os.path.join folder name))
      (with [f (open path "rb")]
        (setv data (.read f)))
      (when (or (in (.encode SECRET-PROMPT) data) (in (.encode SECRET-OUTPUT) data)
                (in (.encode key) data))
        (.append found path)))
    (.assertEqual self found []))

  ;; @lat: [[gateway-hy#Tests#An order key works once]]
  (defn test-an-order-key-works-once [self]
    (setv key "order-key-3")
    (.registered self key)
    (.assertEqual self (get (.chat self key) 0) 200)
    (setv again (.chat self key))
    (.assertEqual self (get again 0) 409)
    (.assertEqual self (.error-code self again) "order_used")
    (.assertEqual self (get self.engine-state "calls") 1))

  ;; @lat: [[gateway-hy#Tests#An order key works once]]
  (defn test-only-one-of-two-simultaneous-calls-runs [self]
    (setv key "order-key-4"
          answers []
          (get self.engine-state "delay") 0.2)
    (.registered self key)
    (setv threads (lfor _ (range 2)
                        (threading.Thread
                          :target (fn [] (.append answers (get (.chat self key) 0))))))
    (for [t threads] (.start t))
    (for [t threads] (.join t))
    (.assertEqual self (sorted answers) [200 409])
    (.assertEqual self (get self.engine-state "calls") 1))

  ;; @lat: [[gateway-hy#Tests#An order key opens nothing else]]
  (defn test-an-order-key-opens-nothing-else [self]
    (setv key "order-key-5"
          [cid _] (.registered self key)
          [other _] (.registered self "order-key-6"))
    (.assertEqual self (get (.call self "GET" "/v1/models" :key key) 0) 401)
    (.assertEqual self (get (.call self "GET" f"/v1/orders/{other}/receipt" :key key) 0) 401)
    (.assertEqual self (get (.call self "POST" "/v1/orders"
                                   {"order" (.order self) "key_sha256" (* "a" 64)} :key key)
                            0)
                  401)
    (.assertEqual self (get (.chat self "not-a-key") 0) 401)
    (.assertEqual self (get self.engine-state "calls") 0))

  ;; @lat: [[gateway-hy#Tests#An order this node cannot honour is refused]]
  (defn test-an-order-this-node-cannot-honour-is-refused [self]
    (setv digest (hash-file self.model-file)
          rows [[{"provider" "did:key:zOther"} "order_provider"]
                [{"node" "did:key:zOther"} "order_node"]
                [{"model" {"revision" "rev-1" "digest" (+ "sha256:" (* "b" 64))}} "order_model"]
                [{"model" {"revision" "rev-2" "digest" digest}} "order_model"]
                [{"kind" "awai.order/2"} "order_kind"]
                [{"work-kind" "human"} "order_work_kind"]
                [{"value-class" "live"} "order_live"]
                [{"value-class" "real"} "order_value_class"]
                [{"value-class" ["live"]} "order_value_class"]
                [{"expires-at" 1} "order_expired"]
                [{"max-tokens" 0} "order_max_tokens"]
                [{"max-tokens" True} "order_max_tokens"]
                [{"nonce" ""} "order_nonce"]
                [{"demand" ""} "order_demand"]])
    (for [[changes code] rows]
      (setv answer (.register self {#** (.order self) #** changes} "unused-key"))
      (.assertEqual self (get answer 0) 400 changes)
      (.assertEqual self (.error-code self answer) code))
    (setv answer (.call self "POST" "/v1/orders" {"order" (.order self) "key_sha256" "short"}))
    (.assertEqual self (.error-code self answer) "order_key"))

  ;; @lat: [[gateway-hy#Tests#An order key belongs to one order]]
  (defn test-an-order-key-belongs-to-one-order [self]
    (setv [_ order] (.registered self "order-key-7"))
    (setv same (.register self order "order-key-8"))
    (.assertEqual self (.error-code self same) "order_exists")
    (setv fresh (.order self)
          reused (.register self fresh "order-key-7"))
    (.assertEqual self (.error-code self reused) "order_key_used")
    ;; The refused order left nothing behind, so it can register with its own key.
    (.assertEqual self (get (.register self fresh "order-key-17") 0) 201))

  ;; @lat: [[gateway-hy#Tests#Registering orders is local only]]
  (defn test-registering-orders-is-local-only [self]
    (setv answer (.call self "POST" "/v1/orders" {"order" (.order self) "key_sha256" (* "a" 64)}
                        :key "wrong"))
    (.assertEqual self (get answer 0) 401))

  ;; @lat: [[gateway-hy#Tests#A different model refuses before spending the order]]
  (defn test-a-different-model-refuses-before-spending-the-order [self]
    (setv key "order-key-9")
    (.registered self key)
    (setv (get self.engine-state "model-path") "/somewhere/else.gguf"
          answer (.chat self key))
    (.assertEqual self (get answer 0) 502)
    (.assertEqual self (.error-code self answer) "upstream_model_mismatch")
    (.assertEqual self (get self.engine-state "calls") 0)
    (setv (get self.engine-state "model-path") self.model-file)
    (.assertEqual self (get (.chat self key) 0) 200))

  ;; @lat: [[gateway-hy#Tests#A different model refuses before spending the order]]
  (defn test-a-changed-model-file-is-refused [self]
    (setv key "order-key-10")
    (.registered self key)
    (with [f (open self.model-file "a")] (.write f "swapped"))
    (setv answer (.chat self key))
    (.assertEqual self (get answer 0) 503)
    (.assertEqual self (.error-code self answer) "serving_changed")
    (.assertEqual self (get self.engine-state "calls") 0))

  ;; @lat: [[gateway-hy#Tests#A failed call leaves no receipt]]
  (defn test-a-failed-call-leaves-no-receipt [self]
    (for [[setting key] [["fail" "order-key-11"] ["no-usage" "order-key-12"]]]
      (setv (get self.engine-state setting) True
            [cid _] (.registered self key)
            answer (.chat self key))
      (.assertEqual self (get answer 0) 502)
      (.assertEqual self (.error-code self answer) "upstream_failed")
      (setv receipt (.call self "GET" f"/v1/orders/{cid}/receipt" :key key))
      (.assertEqual self (get receipt 0) 409)
      (.assertEqual self (.error-code self receipt) "order_failed")
      (setv (get self.engine-state setting) False
            calls (get self.engine-state "calls"))
      (.assertEqual self (.error-code self (.chat self key)) "order_used")
      (.assertEqual self (get self.engine-state "calls") calls)))

  ;; @lat: [[gateway-hy#Tests#An expired order is refused]]
  (defn test-an-expired-order-is-refused [self]
    (setv key "order-key-13"
          soon (+ (int (time.time)) 1))
    (.registered self key :expires_at soon)
    (time.sleep 1.2)
    (setv answer (.chat self key))
    (.assertEqual self (get answer 0) 403)
    (.assertEqual self (.error-code self answer) "order_expired")
    (.assertEqual self (get self.engine-state "calls") 0))

  ;; @lat: [[gateway-hy#Tests#The order caps the tokens]]
  (defn test-the-order-caps-the-tokens [self]
    (setv rows [[None 16] [8 8] [9999 16] [0 16] [True 16]])
    (for [[i [asked want]] (enumerate rows)]
      (setv key f"cap-key-{i}")
      (.registered self key)
      (if (is asked None) (.chat self key) (.chat self key :max_tokens asked))
      (.assertEqual self (get (get self.engine-state "last") "max_tokens") want)))

  ;; @lat: [[gateway-hy#Tests#A streaming client gets the same result]]
  (defn test-a-streaming-client-gets-the-same-result [self]
    (setv key "order-key-14"
          [cid _] (.registered self key)
          req (Request (+ self.base "/v1/chat/completions") :method "POST"
                       :data (.encode (json.dumps {"model" "m" "stream" True
                                                   "messages" [{"role" "user" "content" "hi"}]}))))
    (.add_header req "Authorization" (+ "Bearer " key))
    (with [res (urlopen req :timeout 10)]
      (setv raw (.decode (.read res) "utf-8")
            content-type (.get res.headers "Content-Type")))
    (.assertIn self "text/event-stream" content-type)
    (.assertIn self SECRET-OUTPUT raw)
    (.assertIn self "[DONE]" raw)
    (.assertNotIn self "stream" (get self.engine-state "last"))
    (.assertEqual self (get (.call self "GET" f"/v1/orders/{cid}/receipt" :key key) 0) 200))

  ;; @lat: [[gateway-hy#Tests#The upstream stays on this machine]]
  (defn test-the-upstream-stays-on-this-machine [self]
    (with [_ (.assertRaises self ValueError)]
      (OrderDesk self.gateway.node self.gateway.ledger
                 (os.path.join self.dir.name "other") PROVIDER "http://203.0.113.1:8080"
                 self.engine-file "0.7.0" self.model-file "rev-1")))

  ;; @lat: [[gateway-hy#Tests#The upstream stays on this machine]]
  (defn test-a-redirect-is-not-followed [self]
    (setv key "order-key-15"
          (get self.engine-state "redirect") (+ self.upstream "/v1/chat/completions"))
    (.registered self key)
    (setv answer (.chat self key))
    (.assertEqual self (.error-code self answer) "upstream_failed")
    (.assertEqual self (get self.engine-state "calls") 1))

  ;; @lat: [[gateway-hy#Tests#A receipt survives a restart]]
  (defn test-a-receipt-survives-a-restart [self]
    (setv key "order-key-16"
          [cid _] (.registered self key))
    (.chat self key)
    (setv (. self.gateway orders)
          (OrderDesk self.gateway.node self.gateway.ledger
                     (os.path.join self.state-dir "kotoba-orders") PROVIDER self.upstream
                     self.engine-file "0.7.0" self.model-file "rev-1")
          [status _ receipt] (.call self "GET" f"/v1/orders/{cid}/receipt" :key key))
    (.assertEqual self status 200)
    (.assertTrue self (is-signed receipt))
    (.assertEqual self (.error-code self (.chat self key)) "order_used"))

  ;; @lat: [[gateway-hy#Tests#Orders change nothing when they are off]]
  (defn test-orders-change-nothing-when-they-are-off [self]
    (setv (. self.gateway orders) None
          answer (.call self "POST" "/v1/orders" {"order" {} "key_sha256" ""}))
    (.assertEqual self (get answer 0) 404)
    (.assertFalse self (get (get (get (.call self "GET" "/v1/capabilities") 2) "features") "orders"))
    (.assertEqual self (get (.call self "GET" "/v1/orders/bafy/receipt") 0) 404)))
