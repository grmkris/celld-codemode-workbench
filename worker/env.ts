export interface Env {
  AGENT: DurableObjectNamespace;
  PROBE: DurableObjectNamespace;
  ASSETS?: Fetcher;
  AUTH_SECRET: string;
  MODEL_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  XAI_API_KEY?: string;
  XAI_MODEL?: string;
  ALIBABA_TOKEN_PLAN_API_KEY?: string;
  ALIBABA_MODEL?: string;
  ALLOW_TEST_HOOKS?: string;
}
