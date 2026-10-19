# Service type flipped to ExternalName

Service `${APP}` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate it as a ClusterIP Service selecting `app=${APP}` with port `80` → named target port `http`.
