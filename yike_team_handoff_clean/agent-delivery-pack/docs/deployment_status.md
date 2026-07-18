# Deployment Status

Deployment date: 2026-07-18

Supabase project ref:

```text
hwhflgxdaqfwfdfvnwwt
```

## Database

Migrations already prepared locally:

```text
202607180001_yike_agent_core.sql
202607180002_card_drafts.sql
202607180003_preset_pool_v1.sql
202607180004_feedback_not_suitable.sql
202607180005_card_assets_and_recommendation_audit.sql
202607180006_profile_and_preset_uniqueness.sql
```

Verified by:

```bash
npx supabase db push
```

Result:

```text
202607180006_profile_and_preset_uniqueness.sql pushed
```

## Edge Functions

Deployed functions:

```text
recommendations
feedback
card-drafts
cards
weather-context
preset-pool
profile
```

Function status:

```text
recommendations: ACTIVE, verify_jwt=true
feedback: ACTIVE, verify_jwt=true
card-drafts: ACTIVE, verify_jwt=true
cards: ACTIVE, verify_jwt=true
weather-context: ACTIVE, verify_jwt=true
preset-pool: ACTIVE, verify_jwt=true
profile: ACTIVE, verify_jwt=true
```

Dashboard:

```text
https://supabase.com/dashboard/project/hwhflgxdaqfwfdfvnwwt/functions
```

## Security Notes

- All deployed functions require JWT.
- Product Mode should be called with a real user access token.
- Do not place `service_role` in frontend code.
- Rotate exposed high-privilege keys after deployment.

## API Base

```text
https://hwhflgxdaqfwfdfvnwwt.supabase.co/functions/v1
```

Endpoints:

```text
POST /recommendations
POST /feedback
POST /card-drafts
GET|POST|PATCH /cards
GET /preset-pool
GET|POST|PATCH /profile
POST /weather-context
```

## Real Model Recognition

`card-drafts` is configured for real OpenAI recognition only.

Required Supabase secrets:

```text
OPENAI_API_KEY
OPENAI_CARD_DRAFT_MODEL
```

There is no mock fallback in the deployed card draft recognition path.
