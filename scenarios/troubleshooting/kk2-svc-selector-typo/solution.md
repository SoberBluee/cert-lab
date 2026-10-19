# Service is unreachable

`Endpoints: <none>`. Selector uses `run=${APP}-O1` but the Pod is `run=${APP}`. Delete and recreate the Service (or `kubectl expose pod`) with the correct selector; keep port 80.
