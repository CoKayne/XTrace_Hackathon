export interface ReasonerJudgmentRecord {
  fingerprint: string;
  model: string;
  payload: unknown;
}

export interface ReasonerJudgmentsRepository {
  find(fingerprint: string): Promise<ReasonerJudgmentRecord | null>;
  save(record: ReasonerJudgmentRecord): Promise<void>;
}

export function createMemoryReasonerJudgmentsRepository(): ReasonerJudgmentsRepository {
  const rows = new Map<string, ReasonerJudgmentRecord>();
  return {
    async find(fingerprint) {
      const row = rows.get(fingerprint);
      return row ? structuredClone(row) : null;
    },
    async save(record) {
      rows.set(record.fingerprint, structuredClone(record));
    },
  };
}

export function createSupabaseReasonerJudgmentsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): ReasonerJudgmentsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`PostgreSQL gateway ${response.status}: ${detail.slice(0, 240)}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    async find(fingerprint) {
      const rows = await request(
        `/reasoner_judgments?fingerprint=eq.${encodeURIComponent(fingerprint)}&limit=1`,
      ) as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return null;
      return {
        fingerprint: String(row.fingerprint),
        model: String(row.model),
        payload: row.payload,
      };
    },
    async save(record) {
      await request("/reasoner_judgments?on_conflict=fingerprint", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          fingerprint: record.fingerprint,
          model: record.model,
          payload: record.payload,
          updated_at: new Date().toISOString(),
        }),
      });
    },
  };
}

let singleton: ReasonerJudgmentsRepository | undefined;

export function getReasonerJudgmentsRepository(): ReasonerJudgmentsRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseReasonerJudgmentsRepository({ url, serviceRoleKey })
    : createMemoryReasonerJudgmentsRepository();
  return singleton;
}
