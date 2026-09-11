export interface Env {
  AGENT: DurableObjectNamespace;
  DIRECTORY: DurableObjectNamespace;
  IDENTITY: DurableObjectNamespace;
  TEAM: DurableObjectNamespace;
  TASK: DurableObjectNamespace;
  PROBE: DurableObjectNamespace;
  ASSETS?: Fetcher;
  AUTH_SECRET: string;
  AUTH_FIXTURE?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  MODEL_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  XAI_API_KEY?: string;
  XAI_MODEL?: string;
  ALIBABA_TOKEN_PLAN_API_KEY?: string;
  ALIBABA_MODEL?: string;
  ALLOW_TEST_HOOKS?: string;
  STREAMS_BASE_URL?: string;
  STREAMS_WRITE_TOKEN?: string;
}
