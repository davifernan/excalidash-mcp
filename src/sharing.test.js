import test from "node:test";
import assert from "node:assert/strict";
import { describeUser, parseShareTarget, pickRecipient } from "./sharing.js";

const user = (id, name, email) => ({ id, name, email });

test("resolves an exact email address", () => {
  const found = pickRecipient("davi@example.com", [user("u1", "Davi", "davi@example.com")]);
  assert.equal(found.status, "resolved");
  assert.equal(found.user.id, "u1");
  assert.equal(found.how, "email");
});

// The instance looks users up by substring, so an address that is a prefix of
// somebody else's address comes back as their account. Resolving it because it
// happened to be the only hit would share the board with the wrong person.
test("refuses an address that only nearly matches", () => {
  const found = pickRecipient("davi@example.com", [
    user("u2", "Davi Junior", "davi@example.com.br"),
  ]);
  assert.notEqual(found.status, "resolved");
  assert.equal(found.user, undefined);
  // The near miss is still worth showing: it is probably a typo, not a stranger.
  assert.deepEqual(found.candidates.map((u) => u.id), ["u2"]);
});

test("refuses to choose between two addresses", () => {
  const found = pickRecipient("davi@example", [
    user("u1", "Davi", "davi@example.com"),
    user("u2", "Davi Junior", "davi@example.org"),
  ]);
  assert.equal(found.status, "ambiguous");
  assert.equal(found.candidates.length, 2);
});

test("prefers a name typed in full over a longer one containing it", () => {
  const found = pickRecipient("jan", [
    user("u1", "Jana", "jana@example.com"),
    user("u2", "Jan", "jan@example.com"),
    user("u3", "Janina", "janina@example.com"),
  ]);
  assert.equal(found.status, "resolved");
  assert.equal(found.user.id, "u2");
  assert.equal(found.how, "name");
});

test("refuses to choose between two names", () => {
  const found = pickRecipient("ja", [
    user("u1", "Jana", "jana@example.com"),
    user("u2", "Janina", "janina@example.com"),
  ]);
  assert.equal(found.status, "ambiguous");
});

test("resolves a lone hit that was not typed in full", () => {
  const found = pickRecipient("dav", [user("u1", "Davi", "davi@example.com")]);
  assert.equal(found.status, "resolved");
  assert.equal(found.how, "single");
});

test("resolves a username", () => {
  const found = pickRecipient("davi", [
    { id: "u1", name: "Someone Else", email: "x@example.com", username: "davi" },
  ]);
  assert.equal(found.status, "resolved");
  assert.equal(found.user.id, "u1");
});

test("ignores case and surrounding space", () => {
  const found = pickRecipient("  Davi@Example.com ", [user("u1", "Davi", "davi@example.com")]);
  assert.equal(found.status, "resolved");
});

test("reports nothing found, and nothing asked for", () => {
  assert.equal(pickRecipient("nobody", []).status, "unresolved");
  assert.equal(pickRecipient("   ", [user("u1", "Davi", "davi@example.com")]).status, "empty");
});

test("survives a lookup that returned junk", () => {
  assert.equal(pickRecipient("davi", null).status, "unresolved");
  assert.equal(pickRecipient("davi", [{}, { email: null }]).status, "ambiguous");
});

test("reads a share target with and without an access level", () => {
  assert.deepEqual(parseShareTarget("davi@example.com"), {
    recipient: "davi@example.com",
    access: "edit",
  });
  assert.deepEqual(parseShareTarget(" davi@example.com:view "), {
    recipient: "davi@example.com",
    access: "view",
  });
  assert.deepEqual(parseShareTarget("bootstrap-admin:edit"), {
    recipient: "bootstrap-admin",
    access: "edit",
  });
});

// A colon that is not an access level belongs to the recipient. Only "view" and
// "edit" end a target, so a stray one cannot silently truncate an id.
test("keeps a colon that does not introduce an access level", () => {
  assert.deepEqual(parseShareTarget("weird:id"), { recipient: "weird:id", access: "edit" });
  assert.equal(parseShareTarget(""), null);
  assert.equal(parseShareTarget(undefined), null);
  assert.deepEqual(parseShareTarget(":view"), { recipient: ":view", access: "edit" });
});

test("describes a user by whichever half exists", () => {
  assert.equal(describeUser(user("u1", "Davi", "davi@example.com")), "Davi <davi@example.com>");
  assert.equal(describeUser({ id: "u1", email: "davi@example.com" }), "davi@example.com");
  assert.equal(describeUser({ id: "u1", name: "Davi" }), "Davi");
  assert.equal(describeUser({ id: "u1" }), "u1");
});
