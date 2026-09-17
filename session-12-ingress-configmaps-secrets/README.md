# Session 12 — Kubernetes Ingress, ConfigMaps and Secrets

**Submitted by:** Rashi
**Enrollment / Roll No:** 10389
**Batch:** B

I worked through [lab.md](lab.md) on macOS. The lab is written for a cloud instance using
`minikube addons enable ingress`, and I'm on kind, so I spun up a throwaway kind cluster with the
ingress ports mapped to my host and installed the NGINX controller from the kind manifest instead.
Everything else follows the lab as written.

```console
$ kind create cluster --name session12-lab --config kind-ingress.yaml
$ kubectl version
Client Version: v1.37.0
Server Version: v1.37.0
```

The cluster config maps container port 80 to host port 18080, which is what lets me curl the
ingress from my laptop later. All the manifests are the ones in
[04-full-demo/](04-full-demo/).

---

## Part 1: ConfigMap — Plain-Text Configuration

```console
$ kubectl apply -f configmap.yaml
configmap/yatri-app-config created

$ kubectl get configmap yatri-app-config
NAME               DATA   AGE
yatri-app-config   5      0s
```

`DATA 5` is the number of keys, not the size. `describe` prints the values in full, because there's
nothing secret about them:

```console
$ kubectl describe configmap yatri-app-config
Name:         yatri-app-config
Namespace:    default
Labels:       app=yatri-app
Annotations:  <none>

Data
====
APP_PORT:
----
5000

DEFAULT_CURRENCY:
----
INR

ENVIRONMENT:
----
production

LOG_LEVEL:
----
INFO

MAX_BOOKING_DAYS:
----
30
```

Pulling one key out with jsonpath, which is the bit that's actually useful in scripts:

```console
$ kubectl get configmap yatri-app-config -o jsonpath='{.data.DEFAULT_CURRENCY}'
INR
```

---

## Part 2: Secret — Database Credentials

```console
$ kubectl apply -f secret.yaml
secret/yatri-db-secret created

$ kubectl get secret yatri-db-secret
NAME              TYPE     DATA   AGE
yatri-db-secret   Opaque   3      0s
```

`describe` behaves differently here. It won't print the values, just how big they are:

```console
$ kubectl describe secret yatri-db-secret
Type:  Opaque

Data
====
POSTGRES_DB:        19 bytes
POSTGRES_PASSWORD:  14 bytes
POSTGRES_USER:      11 bytes
```

That's the only real difference in handling, and it's cosmetic. The lab makes a point of this and
it's worth proving, because base64 is encoding, not encryption. Anyone who can read the Secret can
read the password:

```console
$ kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}'
c2VjcmV0cGFzc3dvcmQ=

$ kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 --decode
secretpassword
```

All three, decoded straight out of the cluster with no special permissions:

```console
POSTGRES_USER     : yatri_admin
POSTGRES_PASSWORD : secretpassword
POSTGRES_DB       : yatri_production_db
```

So a Secret is not a safe place to put something on its own. It keeps credentials out of your YAML
and out of `describe` output, and that's about it. Actual protection needs encryption at rest on
etcd plus RBAC limiting who can read secrets in the namespace.

---

## Part 3: Backend — Injecting Both as Environment Variables

[04-full-demo/backend.yaml](04-full-demo/backend.yaml) pulls the ConfigMap in wholesale with
`envFrom`, then names the three Secret keys individually with `secretKeyRef`.

```console
$ kubectl apply -f backend.yaml
deployment.apps/yatri-backend created
service/yatri-backend-service created

$ kubectl rollout status deployment/yatri-backend
deployment "yatri-backend" successfully rolled out
```

Checking inside a running pod that all eight variables actually arrived:

```console
$ kubectl exec deployment/yatri-backend -- env | grep -E "ENVIRONMENT|LOG_LEVEL|APP_PORT|DEFAULT_CURRENCY|MAX_BOOKING|POSTGRES"
APP_PORT=5000
DEFAULT_CURRENCY=INR
ENVIRONMENT=production
LOG_LEVEL=INFO
MAX_BOOKING_DAYS=30
POSTGRES_DB=yatri_production_db
POSTGRES_PASSWORD=secretpassword
POSTGRES_USER=yatri_admin
```

Five from the ConfigMap, three from the Secret, and once they're inside the container they're
completely indistinguishable. `POSTGRES_PASSWORD` is sitting there in plain text in the process
environment, which is the second half of the point above.

The difference between the two injection styles matters in practice. `envFrom` grabs every key in
the ConfigMap, so adding a key later means the pod picks it up on next restart without editing the
Deployment. `secretKeyRef` names each key explicitly, which is more typing but means you can see
exactly which credentials a workload has access to by reading its manifest.

---

## Part 4: Frontend

```console
$ kubectl apply -f frontend.yaml
deployment.apps/yatri-frontend created
service/yatri-frontend-service created

$ kubectl get pods
NAME                             READY   STATUS    RESTARTS   AGE
yatri-backend-6c58cb99c7-9cvhz   1/1     Running   0          115s
yatri-backend-6c58cb99c7-dm7h2   1/1     Running   0          115s
yatri-frontend-ddcfc4b5f-gxncx   1/1     Running   0          115s
yatri-frontend-ddcfc4b5f-hlr2j   1/1     Running   0          115s
```

Both services are `ClusterIP`, which is the checklist item and also the whole reason the next part
exists:

```console
$ kubectl get svc
NAME                     TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
kubernetes               ClusterIP   10.96.0.1       <none>        443/TCP   4m3s
yatri-backend-service    ClusterIP   10.96.105.67    <none>        80/TCP    119s
yatri-frontend-service   ClusterIP   10.96.101.213   <none>        80/TCP    119s
```

Neither has an external IP. Without an Ingress there is no way in from outside the cluster.

---

## Part 5: Ingress

The lab says `minikube addons enable ingress`. On kind the equivalent is applying the controller
manifest:

```console
$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
namespace/ingress-nginx created
...
ingressclass.networking.k8s.io/nginx created
validatingwebhookconfiguration.admissionregistration.k8s.io/ingress-nginx-admission created

$ kubectl get pods -n ingress-nginx
NAME                                        READY   STATUS    RESTARTS   AGE
ingress-nginx-controller-596f5b6bcf-r444w   1/1     Running   0          75s
```

Something I hadn't appreciated before doing this: the Ingress *resource* is just a routing table
sitting in etcd. It does nothing by itself. The controller pod above is the thing that reads it and
reconfigures a real nginx. Without a controller installed you can apply Ingress YAML all day and
nothing will route.

```console
$ kubectl apply -f ingress.yaml
ingress.networking.k8s.io/yatri-ingress created

$ kubectl get ingress
NAME            CLASS   HOSTS         ADDRESS     PORTS   AGE
yatri-ingress   nginx   yatri.local   localhost   80      30s
```

`ADDRESS` took a few seconds to appear. On kind it fills in as `localhost` rather than an IP, which
caught me out when I tried to read it with `jsonpath={.status.loadBalancer.ingress[0].ip}` and got
nothing back. It's under `.hostname`, not `.ip`.

```console
$ kubectl describe ingress yatri-ingress
Name:             yatri-ingress
Address:          localhost
Ingress Class:    nginx
Rules:
  Host         Path  Backends
  ----         ----  --------
  yatri.local
               /api(/|$)(.*)   yatri-backend-service:80 (10.244.0.12:5000,10.244.0.13:5000)
               /               yatri-frontend-service:80 (10.244.0.10:80,10.244.0.11:80)
Annotations:   nginx.ingress.kubernetes.io/rewrite-target: /$2
               nginx.ingress.kubernetes.io/ssl-redirect: false
               nginx.ingress.kubernetes.io/use-regex: true
```

The pod IPs listed next to each rule are a useful sanity check. If that bracket is empty, the
Ingress is pointing at a Service that isn't selecting anything.

---

## Part 6: Testing the Routing

Two paths, one host, two different backends.

```console
$ curl -s -H "Host: yatri.local" http://localhost:18080/
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
```

```console
$ curl -s -H "Host: yatri.local" http://localhost:18080/api/
Yatri Backend API
=================
ENVIRONMENT     : production
LOG_LEVEL       : INFO
DEFAULT_CURRENCY: INR
POSTGRES_USER   : yatri_admin
POSTGRES_DB     : yatri_production_db
```

Both return 200:

```console
/       -> 200
/api/   -> 200
```

The `/api/` response is the satisfying part of this whole lab, because it proves the entire chain
end to end. The values in that body came from the ConfigMap and the Secret, through `envFrom` and
`secretKeyRef`, into the pod's environment, out through a ClusterIP service, and back through the
ingress controller with the `/api` prefix stripped by the rewrite annotation.

### Why the Host header is not optional

I tried it without `-H` to see what would happen:

```console
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18080/
404

$ curl -s http://localhost:18080/
<html>
<head><title>404 Not Found</title></head>
```

404, not a connection error. The request reaches the controller fine, but every rule in this Ingress
is scoped to `host: yatri.local`, so a request that doesn't claim that hostname matches nothing.
Real traffic would carry the right `Host` header because DNS would have sent it there. `-H` is
faking what DNS would normally do.

---

## Part 7: The Full Picture

```console
$ kubectl get configmap,secret,deployment,svc,ingress
NAME                         DATA   AGE
configmap/yatri-app-config   5      3m4s

NAME                     TYPE     DATA   AGE
secret/yatri-db-secret   Opaque   3      2m59s

NAME                             READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/yatri-backend    2/2     2            2           2m51s
deployment.apps/yatri-frontend   2/2     2            2           2m51s

NAME                             TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
service/yatri-backend-service    ClusterIP   10.96.105.67    <none>        80/TCP    2m51s
service/yatri-frontend-service   ClusterIP   10.96.101.213   <none>        80/TCP    2m51s

NAME                                      CLASS   HOSTS         ADDRESS     PORTS   AGE
ingress.networking.k8s.io/yatri-ingress   nginx   yatri.local   localhost   80      47s
```

---

## Part 8: The Newline Bug

This is the drill from [troubleshooting/secret-base64-gotcha.md](troubleshooting/secret-base64-gotcha.md).
`echo` adds a trailing newline, `echo -n` doesn't, and base64 faithfully encodes the difference:

```console
$ echo "secretpassword" | base64
c2VjcmV0cGFzc3dvcmQK

$ echo -n "secretpassword" | base64
c2VjcmV0cGFzc3dvcmQ=
```

The lab says to decode it and watch your cursor jump to the next line. That works, but it's hard to
be sure of what you saw, so I piped both through `xxd` to make the byte visible:

```console
$ echo "c2VjcmV0cGFzc3dvcmQK" | base64 --decode | xxd
00000000: 7365 6372 6574 7061 7373 776f 7264 0a    secretpassword.

$ echo "c2VjcmV0cGFzc3dvcmQ=" | base64 --decode | xxd
00000000: 7365 6372 6574 7061 7373 776f 7264       secretpassword
```

There it is: `0a` on the end of the first one and nothing on the second.

```console
wrong: 15
right: 14
```

15 bytes versus 14. This also explains the `POSTGRES_PASSWORD: 14 bytes` from Part 2 — that's how
you can tell from `describe` alone that the Secret in this repo was encoded correctly. If it said 15
bytes, the password would be wrong and every database connection would be refused with an
authentication error that tells you nothing about why.

---

## Part 9: Updating a ConfigMap Under a Running Pod

```console
$ kubectl patch configmap yatri-app-config --type merge -p '{"data":{"ENVIRONMENT":"staging"}}'
configmap/yatri-app-config patched

$ kubectl get configmap yatri-app-config -o jsonpath='{.data.ENVIRONMENT}'
staging
```

The ConfigMap has definitely changed. The running pod hasn't noticed:

```console
$ kubectl exec deployment/yatri-backend -- env | grep ENVIRONMENT
ENVIRONMENT=production

$ curl -s -H "Host: yatri.local" http://localhost:18080/api/ | grep ENVIRONMENT
ENVIRONMENT     : production
```

Environment variables are read once, when the container starts. Nothing goes back and re-reads the
ConfigMap afterwards. A rolling restart is what picks it up:

```console
$ kubectl rollout restart deployment/yatri-backend
deployment.apps/yatri-backend restarted

$ kubectl exec deployment/yatri-backend -- env | grep ENVIRONMENT
ENVIRONMENT=staging
```

### A thing that confused me for a minute

Straight after the restart, `kubectl exec` said `staging` but curl still said `production`. I
thought I'd broken something. Checking every pod individually explained it:

```console
$ kubectl get pods -l app=yatri-backend
NAME                             READY   STATUS        RESTARTS   AGE
yatri-backend-559fff97b6-5ddhs   1/1     Running       0          6s
yatri-backend-559fff97b6-cq7dh   1/1     Running       0          6s
yatri-backend-6c58cb99c7-9cvhz   1/1     Terminating   0          3m6s
yatri-backend-6c58cb99c7-dm7h2   1/1     Terminating   0          3m6s

pod/yatri-backend-559fff97b6-5ddhs       ENVIRONMENT=staging
pod/yatri-backend-559fff97b6-cq7dh       ENVIRONMENT=staging
pod/yatri-backend-6c58cb99c7-9cvhz       ENVIRONMENT=production
pod/yatri-backend-6c58cb99c7-dm7h2       ENVIRONMENT=production
```

The two old pods were still `Terminating`, and a terminating pod is still in the Service's endpoint
list until it actually goes away. My curl had been load balanced onto one of them. `kubectl exec`
picked a new pod, curl happened to hit an old one, and both were telling the truth.

Once the old pods finished terminating, it was consistent every time:

```console
$ for i in 1 2 3 4 5 6; do curl -s -H "Host: yatri.local" http://localhost:18080/api/ | grep ENVIRONMENT; done
ENVIRONMENT     : staging
ENVIRONMENT     : staging
ENVIRONMENT     : staging
ENVIRONMENT     : staging
ENVIRONMENT     : staging
ENVIRONMENT     : staging
```

Worth knowing that this is specific to env vars. A ConfigMap mounted as a volume does get updated in
place by the kubelet, though with a delay and only if the app bothers to re-read the file.

---

## Lab Completion Checklist

- [x] Applied `configmap.yaml` and read a key using `-o jsonpath`
- [x] Applied `secret.yaml` and decoded `POSTGRES_PASSWORD` with `base64 --decode`
- [x] Applied `backend.yaml` and verified environment variables inside the pod with `kubectl exec`
- [x] Applied `frontend.yaml` and confirmed both services are `ClusterIP` type
- [x] Enabled the NGINX Ingress Controller and confirmed the controller pod is `Running`
- [x] Applied `ingress.yaml` and confirmed an `ADDRESS` appeared in `kubectl get ingress`
- [x] Tested path `/` returns Nginx HTML using `curl -H "Host: yatri.local"`
- [x] Tested path `/api/` returns the backend config values using `curl -H "Host: yatri.local"`
- [x] Demonstrated the `echo` vs `echo -n` newline bug difference
- [x] Triggered a rolling restart after updating a ConfigMap value and confirmed the new value loaded

---

## Cleanup

```console
$ kind delete cluster --name session12-lab
Deleting cluster "session12-lab" ...
```

---

## What I Understood

- ConfigMaps and Secrets are nearly the same object. Same shape, same injection mechanisms, and the
  only real differences are base64 encoding and `describe` hiding the values. Secrets are a
  convention for keeping credentials out of your YAML, not a security boundary.
- Because base64 decodes in one command, a Secret only protects anything if something else is doing
  the actual work: encryption at rest on etcd, and RBAC controlling who can read secrets in the
  namespace.
- `envFrom` and `secretKeyRef` are a trade-off, not a style choice. Bulk import means new keys
  arrive automatically; naming keys one by one means the manifest documents exactly what a workload
  can see.
- An Ingress resource on its own does nothing at all. It's routing rules in etcd, and a controller
  pod has to be running to turn them into actual nginx config.
- Host-based routing means the `Host` header decides everything. No header, no match, 404 — even
  though the controller received the request perfectly fine.
- Environment variables are frozen at container start. Patching a ConfigMap changes the ConfigMap
  and nothing else, and `rollout restart` is what makes the change real. Volume mounts behave
  differently and do get refreshed.
- Terminating pods keep serving traffic until they're gone, which is normally a good thing and is
  exactly what makes rolling updates seamless. It also means that during a restart you can get
  answers from both the old and new version, which looks like a bug when you're watching for one.
- `echo` versus `echo -n` is a genuinely nasty bug because the symptom is an authentication failure
  that says nothing about a newline. Checking the byte count in `describe secret` is a quick way to
  catch it before it costs you an afternoon.

---

## Resources

- https://kubernetes.io/docs/concepts/configuration/configmap/
- https://kubernetes.io/docs/concepts/configuration/secret/
- https://kubernetes.io/docs/concepts/services-networking/ingress/
- https://kubernetes.github.io/ingress-nginx/
