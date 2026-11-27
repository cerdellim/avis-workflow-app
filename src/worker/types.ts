export type AppVariables = {
  requestId: string;
  userId?: string;
  errorCode?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};
