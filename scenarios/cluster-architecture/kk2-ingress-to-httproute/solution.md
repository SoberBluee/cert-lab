# Replace Ingress with HTTPRoute

Create HTTPRoute `${APP}-route` in `${NS}` attached to Gateway `traefik-gateway` / namespace `traefik` / section `web`, host `${APP}.${NS}.lab`, backend Service `${APP}:80`. Delete Ingress `${APP}`.
