;; Paid inference for one order at a time (network-awai-apex ADR 0027).
;;
;; An order fixes the buyer, the provider, this node and the model. Its key
;; opens exactly one call to a local llama.cpp server, which is measured here
;; rather than reported by the caller. The result is a receipt signed by this
;; node. No prompt or output is stored: the receipt and the ledger hold only
;; hashes, so they can be replicated without exposing the work.
;;
;; A receipt records that work happened. It does not say the work was good, and
;; nothing here moves money.

(import hashlib hmac json os time
        urllib.error [HTTPError URLError]
        urllib.parse [urlsplit]
        urllib.request [HTTPRedirectHandler ProxyHandler Request build-opener])
(import kotoba_gateway.identity [canonical]
        kotoba_gateway.ledger [cid-of])

(setv ORDER-KIND "awai.order/1"
      RECEIPT-KIND "awai.work-receipt/1"
      UPSTREAM-TIMEOUT-SECONDS 600
      MAX-UPSTREAM-BYTES (* 32 1024 1024)
      LOOPBACK #{"127.0.0.1" "::1" "localhost"}
      HEX-DIGITS (set "0123456789abcdef"))

(defclass OrderError [Exception]
  "A refused order. `status` and `code` go to the caller as they are."
  (defn __init__ [self status code message]
    (.__init__ (super) message)
    (setv self.status status
          self.code code
          self.message message)))

(defclass NoRedirect [HTTPRedirectHandler]
  "A redirect could carry a prompt off this machine, so it is an error."
  (defn redirect_request [self #* args #** kwargs] None))

(defn hash-file [path]
  "`sha256:<hex>` of a file, read in chunks because models are large."
  (setv digest (hashlib.sha256))
  (with [f (open path "rb")]
    (while True
      (setv chunk (.read f (* 1024 1024)))
      (when (not chunk) (break))
      (.update digest chunk)))
  (+ "sha256:" (.hexdigest digest)))

(defn key-hash [key]
  (.hexdigest (hashlib.sha256 (.encode key "utf-8"))))

(defn is-hex-256 [text]
  (and (isinstance text str) (= (len text) 64) (.issubset (set text) HEX-DIGITS)))

(defn is-count [value]
  "A whole number that is not a boolean, which Python also counts as an int."
  (and (isinstance value int) (not (isinstance value bool)) (>= value 0)))

(defn file-stamp [path]
  (setv info (os.stat path))
  #(info.st_size info.st_mtime_ns))

(defn atomic-write [path data]
  (setv tmp (+ path ".tmp"))
  (with [f (open tmp "wb")] (.write f data))
  (os.replace tmp path))

(defn create-exclusive [path data]
  "Write a new file, or return False when it already exists."
  (try
    (setv fd (os.open path (| os.O_WRONLY os.O_CREAT os.O_EXCL) 0o600))
    (except [FileExistsError] (return False)))
  (with [f (os.fdopen fd "wb")] (.write f data))
  True)

(defclass OrderDesk []
  (defn __init__ [self node ledger root provider upstream engine-file engine-version
                  model-file model-revision]
    (setv parts (urlsplit upstream))
    (when (or (not-in parts.scheme #{"http" "https"}) (not-in parts.hostname LOOPBACK))
      (raise (ValueError "the order upstream must be a local address")))
    (setv self.node node
          self.ledger ledger
          self.root root
          self.provider provider
          self.upstream (.rstrip upstream "/")
          self.engine-file engine-file
          self.model-file (os.path.realpath model-file)
          self.engine-stamp (file-stamp engine-file)
          self.model-stamp (file-stamp model-file)
          self.engine {"name" "llama.cpp" "version" engine-version
                       "digest" (hash-file engine-file)}
          self.model {"revision" model-revision "digest" (hash-file model-file)}
          self.opener (build-opener (ProxyHandler {}) NoRedirect))
    (os.makedirs (os.path.join root "keys") :exist_ok True))

  ;; -- paths --

  (defn order-dir [self cid] (os.path.join self.root cid))
  (defn order-path [self cid name] (os.path.join (.order-dir self cid) name))

  ;; -- registration --

  (defn check-binding [self order]
    "Refuse an order this node could not honestly serve."
    (defn refuse [code message] (raise (OrderError 400 code message)))
    (when (not (isinstance order dict))
      (refuse "order_invalid" "The order must be a JSON object."))
    (when (!= (.get order "kind") ORDER-KIND)
      (refuse "order_kind" "This node serves awai.order/1."))
    (when (!= (.get order "work-kind") "compute")
      (refuse "order_work_kind" "This node serves compute orders only."))
    (when (= (.get order "value-class") "live")
      (refuse "order_live" "Live orders are not approved on this node."))
    (when (not (in (.get order "value-class") ["simulation" "devnet"]))
      (refuse "order_value_class" "The order has no known value class."))
    (when (!= (.get order "provider") self.provider)
      (refuse "order_provider" "The order names another provider."))
    (when (!= (.get order "node") self.node.did)
      (refuse "order_node" "The order names another node."))
    (setv model (.get order "model"))
    (when (or (not (isinstance model dict))
              (!= (.get model "digest") (get self.model "digest"))
              (!= (.get model "revision") (get self.model "revision")))
      (refuse "order_model" "The order pins a model this node does not serve."))
    (setv max-tokens (.get order "max-tokens"))
    (when (or (not (is-count max-tokens)) (= max-tokens 0))
      (refuse "order_max_tokens" "The order needs a positive max-tokens."))
    (when (not (and (isinstance (.get order "nonce") str) (.get order "nonce")))
      (refuse "order_nonce" "The order needs a nonce."))
    (when (not (and (isinstance (.get order "demand") str) (.get order "demand")))
      (refuse "order_demand" "The order needs a demand class."))
    (when (not (is-count (.get order "expires-at")))
      (refuse "order_expires_at" "The order needs an expiry."))
    (when (<= (get order "expires-at") (time.time))
      (refuse "order_expired" "The order has already expired.")))

  (defn register [self order hashed-key]
    "Accept an order and the hash of its key. Returns the order's CID."
    (.check-binding self order)
    (when (not (is-hex-256 hashed-key))
      (raise (OrderError 400 "order_key" "key_sha256 must be 64 hex digits.")))
    (setv cid (cid-of (canonical order)))
    (try
      (os.mkdir (.order-dir self cid))
      (except [FileExistsError]
        (raise (OrderError 409 "order_exists" "This order is already registered."))))
    (atomic-write (.order-path self cid "order.json") (canonical order))
    (when (not (create-exclusive (os.path.join self.root "keys" hashed-key) (.encode cid "ascii")))
      ;; Leave no order behind that no key can open, so it can register again.
      (os.remove (.order-path self cid "order.json"))
      (os.rmdir (.order-dir self cid))
      (raise (OrderError 409 "order_key_used" "This key already belongs to an order.")))
    cid)

  (defn lookup [self key]
    "The (cid, order) a key opens, or None."
    (setv path (os.path.join self.root "keys" (key-hash key)))
    (when (not (os.path.isfile path)) (return None))
    (with [f (open path :encoding "ascii")] (setv cid (.read f)))
    (with [f (open (.order-path self cid "order.json") "rb")]
      #(cid (json.loads (.read f)))))

  ;; -- upstream --

  (defn call-upstream [self request]
    (with [res (.open self.opener request :timeout UPSTREAM-TIMEOUT-SECONDS)]
      (setv data (.read res (+ MAX-UPSTREAM-BYTES 1))))
    (when (> (len data) MAX-UPSTREAM-BYTES)
      (raise (ValueError "the upstream response is too large")))
    (json.loads data))

  (defn check-serving [self]
    "Refuse before spending an order if the receipt could not be true."
    (when (or (!= (file-stamp self.model-file) self.model-stamp)
              (!= (file-stamp self.engine-file) self.engine-stamp))
      (raise (OrderError 503 "serving_changed"
                         "The model or engine file changed after its digest was taken.")))
    (try
      (setv props (.call-upstream self (Request (+ self.upstream "/props"))))
      (except [e [HTTPError URLError OSError ValueError]]
        (raise (OrderError 502 "upstream_unavailable" "The inference engine did not answer."))))
    (setv serving (.get props "model_path"))
    (when (or (not (isinstance serving str)) (!= (os.path.realpath serving) self.model-file))
      (raise (OrderError 502 "upstream_model_mismatch"
                         "The inference engine is serving a different model."))))

  ;; -- serving --

  (defn fail [self cid code message]
    "Record that this order is spent without a result. It is not run again."
    (atomic-write (.order-path self cid "failed.json") (canonical {"code" code}))
    (raise (OrderError 502 code message)))

  (defn serve [self cid order key raw-body body]
    "Run the one call this order allows. Returns the response and the receipt."
    (when (<= (get order "expires-at") (time.time))
      (raise (OrderError 403 "order_expired" "This order has expired.")))
    (.check-serving self)
    (when (not (create-exclusive (.order-path self cid "claim") b""))
      (raise (OrderError 409 "order_used" "This order's key has already been used.")))
    (setv forwarded (dict body))
    (for [name ["stream" "stream_options" "n"]]
      (.pop forwarded name None))
    (setv cap (get order "max-tokens")
          asked (.get forwarded "max_tokens")
          (get forwarded "max_tokens") (if (and (is-count asked) (< 0 asked cap)) asked cap)
          started (int (time.time)))
    (try
      (setv reply (.call-upstream self
                                  (Request (+ self.upstream "/v1/chat/completions")
                                           :data (.encode (json.dumps forwarded) "utf-8")
                                           :headers {"Content-Type" "application/json"}
                                           :method "POST")))
      (setv message (get (get (get reply "choices") 0) "message")
            usage (get reply "usage")
            prompt-tokens (get usage "prompt_tokens")
            completion-tokens (get usage "completion_tokens"))
      (except [e [HTTPError URLError OSError ValueError KeyError IndexError TypeError]]
        (.fail self cid "upstream_failed" "The inference engine did not return a result.")))
    (when (not (and (isinstance message dict) (is-count prompt-tokens) (is-count completion-tokens)))
      (.fail self cid "upstream_failed" "The inference engine returned no measurement."))
    (setv measured {"prompt-tokens" prompt-tokens
                    "completion-tokens" completion-tokens
                    "started-at" started
                    "finished-at" (int (time.time))}
          input-hash (+ "hmac-sha256:" (.hexdigest (hmac.new (.encode key "utf-8") raw-body hashlib.sha256)))
          output-cid (cid-of (canonical message))
          head (.append self.ledger f"order-{cid}" {"order" cid "input" input-hash
                                                    "output" output-cid "measured" measured})
          receipt (.sign-document self.node
                                  {"kind" RECEIPT-KIND
                                   "work-kind" (get order "work-kind")
                                   "order" cid
                                   "provider" self.provider
                                   "node" self.node.did
                                   "input" input-hash
                                   "output" output-cid
                                   "engine" self.engine
                                   "model" self.model
                                   "measured" measured
                                   "ledger-head" (get head "cid")
                                   "demand" (get order "demand")
                                   "nonce" (get order "nonce")}))
    (atomic-write (.order-path self cid "receipt.json") (canonical receipt))
    {"reply" reply "message" message "receipt" receipt
     "receipt-cid" (cid-of (canonical receipt))})

  (defn receipt [self cid]
    "The stored receipt, or an error that says why there is none."
    (when (not (os.path.isdir (.order-dir self cid)))
      (raise (OrderError 404 "order_unknown" "No such order.")))
    (when (os.path.isfile (.order-path self cid "failed.json"))
      (raise (OrderError 409 "order_failed" "This order failed and has no receipt.")))
    (setv path (.order-path self cid "receipt.json"))
    (when (not (os.path.isfile path))
      (raise (OrderError 404 "receipt_pending" "This order has no receipt yet.")))
    (with [f (open path "rb")]
      (json.loads (.read f)))))
