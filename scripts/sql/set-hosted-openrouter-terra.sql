-- Switch hosted OpenRouter primary model to GPT-5.6 Terra.
-- Run in Supabase SQL Editor (project: drckigvqfhsbedzyafyr or your ref).
-- Requires openrouter.apiKey in developer_secrets.

update public.developer_secrets
set secrets = jsonb_set(
  coalesce(secrets, '{}'::jsonb),
  '{providers}',
  coalesce(secrets->'providers', '{}'::jsonb)
    || jsonb_build_object(
      'primary', 'openrouter',
      'primaryModel', 'openai/gpt-5.6-terra'
    ),
  true
)
where id = 'singleton';

-- Verify:
-- select secrets->'providers' from public.developer_secrets where id = 'singleton';
