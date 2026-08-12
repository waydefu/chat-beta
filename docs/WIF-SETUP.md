# Workload Identity Federation 設定 runbook

目的：讓 `Deploy Firebase production` workflow 能在沒有長期 service account key 的情況下部署，取代目前每次都要手動從 Cloud Shell 出的流程。追蹤於 issue #7。

前置條件：以對 `f-chat-wayde-fu` 有 Owner 或 IAM Admin 權限的帳號操作。全部指令在 Google Cloud Shell 執行。

參數如下，全篇沿用：

| 項目 | 值 |
| --- | --- |
| Project ID | `f-chat-wayde-fu` |
| Project number | `838739455782` |
| Repository | `waydefu/chat-beta` |
| Pool | `github` |
| Provider | `github` |
| Service account | `github-deploy@f-chat-wayde-fu.iam.gserviceaccount.com` |

## 1. 啟用 API

```bash
gcloud config set project f-chat-wayde-fu
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com
```

## 2. 建立 service account

```bash
gcloud iam service-accounts create github-deploy --display-name="GitHub Actions deploy"
```

## 3. 建立 workload identity pool

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
```

## 4. 建立 OIDC provider

`--attribute-condition` 是這份設定的安全核心。沒有它，**任何** GitHub repository 都能對這個 pool 換取權杖。不要省略。

```bash
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'waydefu' && assertion.repository == 'waydefu/chat-beta'"
```

## 5. 允許此 repository 冒用該 service account

```bash
gcloud iam service-accounts add-iam-policy-binding \
  github-deploy@f-chat-wayde-fu.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/838739455782/locations/global/workloadIdentityPools/github/attribute.repository/waydefu/chat-beta"
```

## 6. 授予部署角色

分兩批。先只給 hosting 需要的，用最小權限跑通第一次；確認可行後再視要部署的 rollout phase 補上後半批。

`hosting_client` 階段：

```bash
for role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding f-chat-wayde-fu \
    --member="serviceAccount:github-deploy@f-chat-wayde-fu.iam.gserviceaccount.com" \
    --role="$role" --condition=None >/dev/null
done
```

要部署 Rules、RTDB 或 Functions 時再加：

```bash
for role in roles/firebaserules.admin roles/firebasedatabase.admin roles/cloudfunctions.developer roles/iam.serviceAccountUser roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding f-chat-wayde-fu \
    --member="serviceAccount:github-deploy@f-chat-wayde-fu.iam.gserviceaccount.com" \
    --role="$role" --condition=None >/dev/null
done
```

這份角色清單是起點而非定論。Functions 部署常會再要求額外權限，正確做法是讓部署失敗、讀錯誤訊息指名的權限再補，而不是預先大範圍授權。

## 7. 取得要填進 GitHub 的兩個值

```bash
gcloud iam workload-identity-pools providers describe github \
  --location=global --workload-identity-pool=github --format="value(name)"
```

輸出應為 `projects/838739455782/locations/global/workloadIdentityPools/github/providers/github`。

## 8. 寫入 GitHub production environment

兩個都是 secret，不是 variable，且必須放在 `production` environment scope（既有的 `VITE_*` 變數也在那裡）。

```bash
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --env production --repo waydefu/chat-beta \
  --body "projects/838739455782/locations/global/workloadIdentityPools/github/providers/github"
gh secret set GCP_DEPLOY_SERVICE_ACCOUNT --env production --repo waydefu/chat-beta \
  --body "github-deploy@f-chat-wayde-fu.iam.gserviceaccount.com"
```

## 9. 驗證

用 `hosting_client` 階段跑一次真實部署：

```bash
gh workflow run "Deploy Firebase production" --repo waydefu/chat-beta \
  -f rollout_phase=hosting_client -f migration_verified=true -f providers_verified=true
```

`migration_verified` 與 `providers_verified` 是人為聲明，不是自動檢查。只有在你確認備份、v3 migration、mirror 驗證與 provider staging 測試都完成時才填 `true`。

成功的判準：

- workflow 在 `google-github-actions/auth` 步驟通過，沒有 credentials 錯誤。
- 部署完成後標頭正確：

```bash
curl -sI https://f-chat-wayde-fu.web.app/ | grep -i "content-security-policy\|cache-control"
```

- 全程沒有建立任何 service account JSON key。

## 10. 收尾

驗證通過後更新 `docs/HANDOFF.md`：拿掉「WIF is not yet configured」與「deploy workflow must not be treated as unattended-ready」兩處記載，並關閉 issue #7。

## 安全備註

- 不要建立 service account key。WIF 的整個重點就是不需要長期憑證；`gcloud iam service-accounts keys create` 在這份流程裡沒有任何正當用途。
- attribute condition 若日後要放寬（例如加入其他 repository），要意識到那等同把部署權限交給該 repository 的所有寫入者。
- 這個 service account 只該用於部署。不要拿它跑資料遷移或其他一次性作業。
