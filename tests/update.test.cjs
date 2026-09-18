const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

process.env.ADMIN_PASSWORD = "test-only-password";
process.env.R2_PUBLIC_URL = "https://audio.example.test";
process.env.R2_BUCKET_NAME = "test-bucket";

const storage = require("../dist/lib/r2.js");
const update = require("../dist/api/update.js").default;
const list = require("../dist/api/sermons.js").default;
const feed = require("../dist/api/feed.js").default;
const remove = require("../dist/api/delete.js").default;
const complete = require("../dist/api/upload-complete.js").default;
const { setSessionCookie } = require("../dist/lib/auth.js");

const original = {
  id: "existing-sermon",
  title: "Original title",
  speaker: "Original speaker",
  date: "2026-08-30T10:30:00.000Z",
  description: "Original description",
  keywords: ["romans"],
  audioUrl: `${process.env.R2_PUBLIC_URL}/sermons/original.mp3`,
  audioFileSize: 1234,
  durationSeconds: 600,
  createdAt: "2026-08-30T12:00:00.000Z",
};
const changes = {
  id: original.id,
  title: "Updated & <title>",
  speaker: "New speaker",
  date: "2026-09-01",
  description: "An updated description",
  keywords: [" acts ", "", "faith"],
  durationSeconds: 700,
};
let stored;
let commands;
let failWrite;
let audioMetadata;
let version;
let beforeWrite;

beforeEach(() => {
  stored = [{ ...original }, { ...original, id: "another-sermon" }];
  commands = [];
  failWrite = false;
  version = 1;
  beforeWrite = null;
  audioMetadata = { ContentLength: 4321, ContentType: "audio/mpeg" };
  storage.r2.send = async (command) => {
    commands.push(command.constructor.name);
    if (command.constructor.name === "GetObjectCommand") {
      const data =
        command.input.Key === "sermons.json"
          ? { sermons: stored }
          : {
              title: "Test podcast",
              description: "Test",
              link: "https://example.test",
              language: "en",
              author: "Church",
              email: "test@example.test",
              imageUrl: "https://example.test/image.png",
              category: "Religion",
              subcategory: "Christianity",
            };
      const body = JSON.stringify(data);
      return {
        ETag: `"${version}"`,
        Body: { transformToString: async () => body },
      };
    }
    if (command.constructor.name === "PutObjectCommand") {
      if (failWrite) throw new Error("Simulated storage failure");
      assert.equal(command.input.Key, "sermons.json");
      beforeWrite?.();
      if (command.input.IfMatch !== `"${version}"`) {
        throw Object.assign(new Error("Conflict"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      stored = JSON.parse(command.input.Body).sermons;
      version++;
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      if (audioMetadata instanceof Error) throw audioMetadata;
      return audioMetadata;
    }
    if (command.constructor.name === "DeleteObjectCommand") return {};
    throw new Error(
      `Unexpected storage operation: ${command.constructor.name}`,
    );
  };
});

async function request(
  handler,
  {
    body = changes,
    method = "PUT",
    headers = { authorization: "Bearer test-only-password" },
    query = {},
  } = {},
) {
  const res = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
  await handler({ body, method, headers, query }, res);
  return res;
}

test("updates metadata, preserves identity/audio/order, and appears in list and RSS", async () => {
  const untouched = structuredClone(stored[1]);
  const response = await request(update, {
    body: { ...changes, createdAt: "tampered" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[1], untouched);
  assert.deepEqual(stored[0], {
    ...original,
    ...changes,
    keywords: ["acts", "faith"],
  });
  assert.deepEqual(response.body, stored[0]);
  assert.deepEqual(commands, ["GetObjectCommand", "PutObjectCommand"]);
  const listing = await request(list, { method: "GET", query: { limit: "1" } });
  assert.equal(listing.body.sermons[0].title, changes.title);
  const rss = await request(feed, { method: "GET" });
  assert.equal(rss.statusCode, 200);
  assert.match(rss.body, /Updated &amp; &lt;title&gt;/);
  assert.match(rss.body, /<itunes:author>New speaker<\/itunes:author>/);
  assert.match(rss.body, /<itunes:duration>700<\/itunes:duration>/);
  assert.match(rss.body, /<itunes:keywords>acts,faith<\/itunes:keywords>/);
  assert.match(rss.body, /<guid isPermaLink="false">existing-sermon<\/guid>/);
});

test("clears tags and accepts stored ISO publication dates", async () => {
  const result = await request(update, {
    body: { ...changes, keywords: [], date: original.date },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(stored[0].keywords, []);
  assert.equal(stored[0].date, original.date);
});

test("requires authentication before any storage access", async () => {
  assert.equal((await request(update, { headers: {} })).statusCode, 401);
  assert.deepEqual(commands, []);
});

test("rejects unsupported methods", async () => {
  const response = await request(update, { method: "POST" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "PUT");
  assert.deepEqual(commands, []);
});

test("rejects malformed JSON and invalid metadata without touching storage", async () => {
  for (const body of [
    null,
    "{",
    [],
    { ...changes, title: " " },
    { ...changes, speaker: 10 },
    { ...changes, description: {} },
    { ...changes, date: "2026-02-30" },
    { ...changes, date: "invalid" },
    { ...changes, durationSeconds: 0 },
    { ...changes, durationSeconds: 1.5 },
    { ...changes, durationSeconds: "100" },
    { ...changes, keywords: [42] },
    { ...changes, keywords: "acts" },
  ]) {
    assert.equal(
      (await request(update, { body })).statusCode,
      400,
      JSON.stringify(body),
    );
  }
  assert.deepEqual(commands, []);
});

test("returns 404 for a deleted or unknown sermon", async () => {
  const result = await request(update, { body: { ...changes, id: "missing" } });
  assert.equal(result.statusCode, 404);
  assert.deepEqual(commands, ["GetObjectCommand"]);
});

test("replaces audio only after verifying the uploaded object and retains the episode ID", async () => {
  const audioUrl = `${process.env.R2_PUBLIC_URL}/sermons/replacement.mp3`;
  const result = await request(update, {
    body: JSON.stringify({ ...changes, audioUrl, audioFileSize: 4321 }),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(stored[0].audioUrl, audioUrl);
  assert.equal(stored[0].audioFileSize, 4321);
  assert.equal(stored[0].id, original.id);
  assert.equal(stored[0].createdAt, original.createdAt);
  assert.deepEqual(commands, [
    "GetObjectCommand",
    "HeadObjectCommand",
    "PutObjectCommand",
  ]);
});

test("rejects external, incomplete, oversized and unsafe replacement audio", async () => {
  for (const replacement of [
    { audioUrl: "https://other.example/audio.mp3", audioFileSize: 10 },
    {
      audioUrl: `${process.env.R2_PUBLIC_URL}/sermons/../private.mp3`,
      audioFileSize: 10,
    },
    {
      audioUrl: `${process.env.R2_PUBLIC_URL}/sermons/new.mp3`,
      audioFileSize: 201 * 1024 * 1024,
    },
    { audioUrl: `${process.env.R2_PUBLIC_URL}/sermons/new.mp3` },
    { audioFileSize: 10 },
  ])
    assert.equal(
      (await request(update, { body: { ...changes, ...replacement } }))
        .statusCode,
      400,
    );
  assert.deepEqual(commands, []);
});

test("does not change metadata when replacement audio is missing or mismatched", async () => {
  const body = {
    ...changes,
    audioUrl: `${process.env.R2_PUBLIC_URL}/sermons/new.mp3`,
    audioFileSize: 4321,
  };
  for (const metadata of [
    { ContentLength: 999, ContentType: "audio/mpeg" },
    { ContentLength: 4321, ContentType: "text/plain" },
    Object.assign(new Error("Missing"), { name: "NotFound" }),
  ]) {
    audioMetadata = metadata;
    assert.equal((await request(update, { body })).statusCode, 400);
    assert.deepEqual(stored[0], original);
  }
  assert.ok(!commands.includes("PutObjectCommand"));
});

test("reports failed saves without claiming success", async () => {
  failWrite = true;
  const response = await request(update);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(stored[0], original);
});

test("authenticates the browser session cookie and rejects an invalid session", async () => {
  let cookie;
  setSessionCookie(
    { headers: {} },
    {
      setHeader: (_, value) => {
        cookie = value.split(";")[0];
      },
    },
  );
  assert.equal(
    (await request(update, { headers: { cookie } })).statusCode,
    200,
  );
  commands = [];
  assert.equal(
    (await request(update, { headers: { cookie: "sm_admin=invalid" } }))
      .statusCode,
    401,
  );
  assert.deepEqual(commands, []);
});

test("overlapping edits cannot silently overwrite a saved sermon", async () => {
  const results = await Promise.all([
    request(update),
    request(update, {
      body: { ...changes, id: "another-sermon", title: "Concurrent edit" },
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 409],
  );
  const failedIndex = results.findIndex((result) => result.statusCode === 409);
  const retryBody =
    failedIndex === 0
      ? changes
      : { ...changes, id: "another-sermon", title: "Concurrent edit" };
  assert.equal((await request(update, { body: retryBody })).statusCode, 200);
  assert.equal(stored[0].title, changes.title);
  assert.equal(stored[1].title, "Concurrent edit");
});

test("a concurrent deletion is not resurrected by an edit", async () => {
  beforeWrite = () => {
    stored = stored.filter((sermon) => sermon.id !== original.id);
    version++;
  };
  assert.equal((await request(update)).statusCode, 409);
  assert.equal(
    stored.some((sermon) => sermon.id === original.id),
    false,
  );
});

test("upload completion cannot overwrite a concurrent edit", async () => {
  beforeWrite = () => {
    stored[0].title = "Concurrent edit";
    version++;
  };
  const result = await request(complete, {
    method: "POST",
    body: { ...original, id: "new-sermon" },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(stored[0].title, "Concurrent edit");
  assert.equal(stored.length, 2);
});

test("a conflicting deletion leaves the audio and metadata intact", async () => {
  beforeWrite = () => {
    stored[0].title = "Concurrent edit";
    version++;
  };
  const result = await request(remove, {
    method: "DELETE",
    body: { id: original.id },
  });
  assert.equal(result.statusCode, 409);
  assert.equal(stored[0].title, "Concurrent edit");
  assert.ok(!commands.includes("DeleteObjectCommand"));
});

test("deletion saves metadata before removing audio", async () => {
  assert.equal(
    (await request(remove, { method: "DELETE", body: { id: original.id } }))
      .statusCode,
    200,
  );
  assert.deepEqual(commands, [
    "GetObjectCommand",
    "PutObjectCommand",
    "DeleteObjectCommand",
  ]);
  assert.equal(
    stored.some((sermon) => sermon.id === original.id),
    false,
  );
});

test("creating the first sermons file is conditional on it still being absent", async () => {
  const writes = [];
  storage.r2.send = async (command) => {
    if (command.constructor.name === "GetObjectCommand")
      throw Object.assign(new Error("Missing"), { name: "NoSuchKey" });
    writes.push(command.input);
    return {};
  };
  const snapshot = await storage.getSermonsSnapshot();
  assert.deepEqual(snapshot, { sermons: [], etag: null });
  await storage.putSermons([original], snapshot.etag);
  assert.equal(writes[0].IfNoneMatch, "*");
  assert.equal(writes[0].IfMatch, undefined);
});
