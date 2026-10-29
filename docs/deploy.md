# Deploying

Both targets run the same image. Build the index first, because the Dockerfile
copies `data/session.db` into the image:

```sh
npm run ingest -- path/to/documents.jsonl
docker build -t session-gateway .
docker run --rm -p 8080:8080 session-gateway     # local check: curl localhost:8080/healthz
```

The image is about 370 MB, and the index adds its own size on top. Keep the
container at 0.25–0.5 vCPU and 0.5–1 GiB with minimum instances set to 0, so idle
time costs nothing.

## Free-tier allowances (verify before relying on them)

| | Google Cloud Run (request-based) | Azure Container Apps (Consumption) |
|---|---|---|
| vCPU-seconds / month | 180,000 | 180,000 |
| GiB-seconds / month | 360,000 | 360,000 |
| Requests / month | 2 million | 2 million |
| Scope | per billing account | per subscription |

Sources: [Cloud Run pricing](https://cloud.google.com/run/pricing),
[Google Cloud free features](https://docs.cloud.google.com/free/docs/free-cloud-features),
[Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing),
[Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/).
Checked 2026-10-28.

**Costs outside the compute grant:**

- **Image registry.** Artifact Registry and Azure Container Registry both charge
  for storage. Pushing a public image to GitHub Container Registry (`ghcr.io`)
  avoids that on either cloud.
- **Azure logs.** A Container Apps environment normally ships logs to a Log
  Analytics workspace, which bills per GB ingested. Keep logging minimal, or
  create the environment with `--logs-destination none`.
- **Billing alerts.** Set a budget alert on either cloud before the first deploy.

## Google Cloud Run

```sh
gcloud run deploy session-gateway \
  --image ghcr.io/<owner>/session-gateway:<tag> \
  --region us-central1 \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 2 \
  --allow-unauthenticated
# optional: --set-env-vars MCP_TOKEN=<token>
```

Cloud Run can also build from source (`gcloud run deploy --source .`). That uses
Cloud Build and Artifact Registry, which have their own free allowances.

## Azure Container Apps

```sh
az containerapp env create -n sg-env -g <rg> -l westus2 --logs-destination none
az containerapp create -n session-gateway -g <rg> --environment sg-env \
  --image ghcr.io/<owner>/session-gateway:<tag> \
  --target-port 8080 --ingress external \
  --cpu 0.25 --memory 0.5Gi --min-replicas 0 --max-replicas 2
# optional: --secrets mcp-token=<token> --env-vars MCP_TOKEN=secretref:mcp-token
```

## After deploying

```sh
claude mcp add --transport http session-gateway https://<host>/mcp
# with a token: --header "Authorization: Bearer <token>"
```

Updating the data means a new index, a new image and a new revision. With
scale-to-zero, a cold start reopens the index file, which takes milliseconds for
a session-sized database.
