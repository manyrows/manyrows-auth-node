import { describe, it, expect } from "vitest";
import { ManyRowsServer, ManyRowsServerError } from "../src/index.js";

interface MockCall {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: (url: string, init: RequestInit) => Response): {
  fn: typeof fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const opts = (fetchFn: typeof fetch): ConstructorParameters<typeof ManyRowsServer>[0] => ({
  baseUrl: "https://auth.example.com/", // trailing slash should be trimmed
  workspace: "acme",
  appId: "app-1",
  apiKey: "mr_abc_secret",
  fetch: fetchFn,
});

describe("ManyRowsServer", () => {
  it("checkPermission builds the URL, query, and auth header", async () => {
    const m = mockFetch(() => json(200, { allowed: true, permission: "posts:read", accountId: "u1" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const res = await mr.checkPermission("u1", "posts:read");
    expect(res.allowed).toBe(true);

    const { url, init } = m.calls[0]!;
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("mr_abc_secret");
    expect(url).toMatch(/^https:\/\/auth\.example\.com\/x\/acme\/api\/v1\/apps\/app-1\/check-permission\?/);
    expect(url).toMatch(/accountId=u1/);
    expect(url).toMatch(/permission=posts%3Aread/);
  });

  it("createUser sends a JSON body and parses the result", async () => {
    const m = mockFetch(() => json(201, { user: { id: "u2", email: "a@b.com" }, created: true, roles: ["editor"] }));
    const mr = new ManyRowsServer(opts(m.fn));

    const res = await mr.createUser({ email: "a@b.com", roles: ["editor"] });
    expect(res.created).toBe(true);
    expect(res.user.id).toBe("u2");

    const { init } = m.calls[0]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.com", roles: ["editor"] });
  });

  it("non-2xx throws ManyRowsServerError carrying status and code", async () => {
    const m = mockFetch(() => json(404, { error: "error.notFound", message: "Not found" }));
    const mr = new ManyRowsServer(opts(m.fn));

    await expect(mr.getUser("missing")).rejects.toMatchObject({
      name: "ManyRowsServerError",
      status: 404,
      code: "error.notFound",
      message: "Not found",
    });
    await expect(mr.getUser("missing")).rejects.toBeInstanceOf(ManyRowsServerError);
  });

  it("deleteUserFieldValue handles a 204 with no body", async () => {
    const m = mockFetch(() => new Response(null, { status: 204 }));
    const mr = new ManyRowsServer(opts(m.fn));

    const res = await mr.deleteUserFieldValue("f1", "u1");
    expect(res).toBeUndefined();
    expect(m.calls[0]!.init.method).toBe("DELETE");
    expect(m.calls[0]!.url).toMatch(/\/user-fields\/f1\/users\/u1$/);
  });

  it("listUsers omits undefined query params", async () => {
    const m = mockFetch(() => json(200, { members: [], total: 0, page: 0, pageSize: 50 }));
    const mr = new ManyRowsServer(opts(m.fn));

    await mr.listUsers({ search: "ali" });
    expect(m.calls[0]!.url).toMatch(/\/users\?search=ali$/);
  });

  it("constructor validates required options", () => {
    expect(() => new ManyRowsServer({ baseUrl: "", workspace: "a", appId: "b", apiKey: "c" })).toThrow();
    expect(() => new ManyRowsServer({ baseUrl: "x", workspace: "a", appId: "b", apiKey: "" })).toThrow();
  });
});
