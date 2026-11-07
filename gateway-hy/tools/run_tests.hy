;; Run the gateway test suite: `python -m hy tools/run_tests.hy` (from anywhere,
;; with `.deps` or an installed Hy on the path).
;;
;; One entry point for `npm run test:gateway` and the murakumo actions
;; `kotoba-desktop/gateway` job, which runs argv without a shell.

(import os sys unittest)

(setv ROOT (os.path.dirname (os.path.dirname (os.path.abspath __file__))))
(os.chdir ROOT)
(setv (cut sys.path 0 0) [(os.path.join ROOT ".deps") ROOT])

(setv MODULES ["tests.test_gateway" "tests.test_fleet_secrets"
               "tests.test_mesh"
               "tests.test_orders"
               "tests.test_shard"
               "tests.test_placement"
               "tests.test_python_interop"])

(when (= __name__ "__main__")
  (setv suite (.loadTestsFromNames unittest.defaultTestLoader MODULES)
        result (.run (unittest.TextTestRunner :verbosity 1) suite))
  (sys.exit (if (.wasSuccessful result) 0 1)))
