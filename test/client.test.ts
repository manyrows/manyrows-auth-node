import { describe, it, expect } from "vitest";
import { ManyRowsServer, ManyRowsServerError, ErrorCodes, isCode } from "../src/index.js";

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

  it("hasPermission returns the bare allowed boolean", async () => {
    const m = mockFetch(() => json(200, { allowed: true, permission: "posts:read", accountId: "u1" }));
    const mr = new ManyRowsServer(opts(m.fn));

    await expect(mr.hasPermission("u1", "posts:read")).resolves.toBe(true);
    expect(m.calls[0]!.url).toMatch(/\/check-permission\?/);
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

  it("sends a versioned User-Agent on every request", async () => {
    const m = mockFetch(() => json(200, { allowed: true, permission: "p", accountId: "u1" }));
    const mr = new ManyRowsServer(opts(m.fn));

    await mr.checkPermission("u1", "p");
    const ua = (m.calls[0]!.init.headers as Record<string, string>)["User-Agent"];
    expect(ua).toMatch(/^manyrows-auth-node\//);
  });
});

describe("organizations", () => {
  it("createOrganization posts name/ownerUserId and omits slug when unset", async () => {
    const m = mockFetch(() =>
      json(201, { id: "o1", appId: "app-1", name: "Acme", slug: "acme", status: "active", createdAt: "2026-06-07T00:00:00Z" }),
    );
    const mr = new ManyRowsServer(opts(m.fn));

    const org = await mr.createOrganization({ name: "Acme", ownerUserId: "u1" });
    expect(org.id).toBe("o1");
    expect(org.status).toBe("active");

    const { url, init } = m.calls[0]!;
    expect(init.method).toBe("POST");
    expect(url).toMatch(/\/x\/acme\/api\/v1\/apps\/app-1\/organizations$/);
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme", ownerUserId: "u1" });
  });

  it("listOrganizationsForUser sends userId query and unwraps organizations", async () => {
    const m = mockFetch(() =>
      json(200, { organizations: [{ id: "o1", name: "Acme", slug: "acme", orgRole: "owner" }] }),
    );
    const mr = new ManyRowsServer(opts(m.fn));

    const orgs = await mr.listOrganizationsForUser("u1");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.orgRole).toBe("owner");
    expect(m.calls[0]!.url).toMatch(/\/organizations\?userId=u1$/);
  });

  it("getOrganization 404 surfaces error.notFound via isCode", async () => {
    const m = mockFetch(() => json(404, { error: "error.notFound" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const err = await mr.getOrganization("o1").catch((e: unknown) => e);
    expect(isCode(err, ErrorCodes.notFound)).toBe(true);
    expect(err).toBeInstanceOf(ManyRowsServerError);
    expect((err as ManyRowsServerError).status).toBe(404);
  });

  it("updateOrganization patches only provided fields; deleteOrganization carries actorUserId", async () => {
    const m = mockFetch((url, init) => {
      if (init.method === "PATCH") {
        return json(200, { id: "o1", appId: "app-1", name: "Renamed", slug: "acme", status: "active" });
      }
      // Owner-only delete: the acting end-user must be carried as a query
      // param so the auth server can verify their tier.
      expect(url).toMatch(/\/organizations\/o1\?actorUserId=actor-1$/);
      return new Response(null, { status: 204 });
    });
    const mr = new ManyRowsServer(opts(m.fn));

    const org = await mr.updateOrganization("o1", { name: "Renamed" });
    expect(org.name).toBe("Renamed");
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({ name: "Renamed" });

    await mr.deleteOrganization("o1", "actor-1");
    expect(m.calls[1]!.init.method).toBe("DELETE");
  });

  it("addOrganizationMember by email surfaces error.userNotSignedIn on 409", async () => {
    const m = mockFetch(() => json(409, { error: "error.userNotSignedIn" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const err = await mr
      .addOrganizationMember("o1", { email: "x@y.com", orgRole: "admin" })
      .catch((e: unknown) => e);
    expect(isCode(err, ErrorCodes.userNotSignedIn)).toBe(true);
    expect(m.calls[0]!.url).toMatch(/\/organizations\/o1\/members$/);
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({ orgRole: "admin", email: "x@y.com" });
  });

  it("addOrganizationMember parses the created member", async () => {
    const m = mockFetch(() => json(201, { userId: "u2", email: "x@y.com", orgRole: "admin", status: "active" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const member = await mr.addOrganizationMember("o1", { email: "x@y.com", orgRole: "admin" });
    expect(member.userId).toBe("u2");
    expect(member.orgRole).toBe("admin");
  });

  it("list and get organization members", async () => {
    const m = mockFetch((url) => {
      if (/\/members\/u2$/.test(url)) {
        return json(200, { userId: "u2", orgRole: "admin", status: "active" });
      }
      return json(200, { members: [{ userId: "u2", email: "x@y.com", orgRole: "admin", status: "active" }] });
    });
    const mr = new ManyRowsServer(opts(m.fn));

    const list = await mr.listOrganizationMembers("o1");
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe("x@y.com");
    expect(m.calls[0]!.url).toMatch(/\/organizations\/o1\/members$/);

    const member = await mr.getOrganizationMember("o1", "u2");
    expect(member.orgRole).toBe("admin");
  });

  it("set/remove member surface error.conflict (e.g. last owner)", async () => {
    const m = mockFetch(() => json(409, { error: "error.conflict" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const setErr = await mr.setOrganizationMemberRole("o1", "u2", "member").catch((e: unknown) => e);
    expect(isCode(setErr, ErrorCodes.conflict)).toBe(true);
    expect(m.calls[0]!.init.method).toBe("PATCH");
    expect(m.calls[0]!.url).toMatch(/\/organizations\/o1\/members\/u2$/);
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({ orgRole: "member" });

    const removeErr = await mr.removeOrganizationMember("o1", "u2").catch((e: unknown) => e);
    expect(isCode(removeErr, ErrorCodes.conflict)).toBe(true);
    expect(m.calls[1]!.init.method).toBe("DELETE");
  });

  it("createOrganizationInvite includes optional fields only when set", async () => {
    const m = mockFetch(() =>
      json(201, { id: "i1", email: "x@y.com", orgRole: "admin", status: "pending", createdAt: "t", expiresAt: "t2" }),
    );
    const mr = new ManyRowsServer(opts(m.fn));

    const invite = await mr.createOrganizationInvite("o1", {
      email: "x@y.com",
      orgRole: "admin",
      invitedByUserId: "u1",
    });
    expect(invite.id).toBe("i1");
    expect(invite.status).toBe("pending");
    expect(m.calls[0]!.url).toMatch(/\/organizations\/o1\/invites$/);
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({
      email: "x@y.com",
      orgRole: "admin",
      invitedByUserId: "u1",
    });

    await mr.createOrganizationInvite("o1", { email: "x@y.com" });
    expect(JSON.parse(m.calls[1]!.init.body as string)).toEqual({ email: "x@y.com" });
  });

  it("createOrganizationInvite surfaces error.invitePending on duplicate", async () => {
    const m = mockFetch(() => json(409, { error: "error.invitePending" }));
    const mr = new ManyRowsServer(opts(m.fn));

    const err = await mr.createOrganizationInvite("o1", { email: "x@y.com" }).catch((e: unknown) => e);
    expect(isCode(err, ErrorCodes.invitePending)).toBe(true);
  });

  it("list and revoke organization invites", async () => {
    const m = mockFetch((_url, init) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return json(200, {
        invites: [{ id: "i1", email: "x@y.com", orgRole: "admin", status: "pending", createdAt: "t", expiresAt: "t2" }],
      });
    });
    const mr = new ManyRowsServer(opts(m.fn));

    const invites = await mr.listOrganizationInvites("o1");
    expect(invites).toHaveLength(1);
    expect(invites[0]!.email).toBe("x@y.com");
    expect(m.calls[0]!.url).toMatch(/\/organizations\/o1\/invites$/);

    await mr.revokeOrganizationInvite("o1", "i1");
    expect(m.calls[1]!.init.method).toBe("DELETE");
    expect(m.calls[1]!.url).toMatch(/\/organizations\/o1\/invites\/i1$/);
  });
});
