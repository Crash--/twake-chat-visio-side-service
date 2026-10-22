export interface Config {
  port: number;
  hsToken: string;
  databaseUrl: string;
}

type Env = Record<string, string | undefined>;

export function readConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const value = env[name];
    if (!value) {
      missing.push(name);
    }

    return value ?? "";
  };
  const config = {
    port: Number(env.PORT || 8080),
    hsToken: required("HS_TOKEN"),
    databaseUrl: required("DATABASE_URL"),
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return config;
}
