/**
 * Turning a recipient the model typed into a user id, without ever guessing.
 *
 * Sharing a board is an outward-facing act: it puts a drawing in front of a
 * real person. The failure that matters here is not "no match found", it is
 * "matched the wrong colleague and told nobody". So every rule below resolves
 * only when the answer is unambiguous, and otherwise hands the candidates back
 * for a human to choose from.
 *
 * The instance's own lookup is a substring search, which is why an exact match
 * is required for anything that looks like an address.
 */

/** Access levels a board can be shared at. "none" takes access away again. */
export const ACCESS_LEVELS = ["view", "edit", "none"];

/** The instance's user lookup ignores anything shorter than this. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Pick the one user a query means, out of what the lookup returned.
 *
 * Returns one of:
 *   { status: "resolved",   user, how }   exactly one user, and we can say why
 *   { status: "ambiguous",  candidates }  will not decide: here is what turned up
 *   { status: "unresolved" }              nothing matched
 *   { status: "empty" }                   nothing was asked for
 *
 * "ambiguous" covers a single candidate too. One near miss is still a decision
 * the caller has to make, and handing the account back beats reporting that
 * nobody was found when somebody nearly was.
 */
export const pickRecipient = (query, candidates) => {
  const wanted = String(query ?? "").trim().toLowerCase();
  if (!wanted) return { status: "empty" };

  const found = Array.isArray(candidates) ? candidates : [];
  const byEmail = found.filter((u) => String(u?.email ?? "").toLowerCase() === wanted);
  if (byEmail.length === 1) return { status: "resolved", user: byEmail[0], how: "email" };

  // An address that matched nothing exactly is never resolved by a near miss.
  // The lookup matches substrings, so "davi@example.com" also returns the
  // account "davi@example.com.br", and picking it because it was the only hit
  // would share the board with a different person entirely.
  if (wanted.includes("@")) {
    return found.length ? { status: "ambiguous", candidates: found } : { status: "unresolved" };
  }

  // A name typed in full beats a longer name that merely contains it, so
  // "Jan" resolves even when "Jana" is on the instance too.
  const byName = found.filter(
    (u) =>
      String(u?.name ?? "").toLowerCase() === wanted ||
      String(u?.username ?? "").toLowerCase() === wanted,
  );
  if (byName.length === 1) return { status: "resolved", user: byName[0], how: "name" };

  if (found.length === 1) return { status: "resolved", user: found[0], how: "single" };
  if (found.length === 0) return { status: "unresolved" };
  return { status: "ambiguous", candidates: found };
};

/**
 * Read EXCALIDASH_SHARE_WITH: a recipient, optionally with an access level.
 *
 *   "davi@example.com"        -> edit, the useful default for your own boards
 *   "davi@example.com:view"   -> view
 *   "bootstrap-admin"         -> a user id, which skips the lookup entirely
 *
 * Neither an email address nor a uuid contains a colon, so the last one is a
 * separator whenever what follows it is an access level.
 */
export const parseShareTarget = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const cut = value.lastIndexOf(":");
  if (cut > 0) {
    const suffix = value.slice(cut + 1).trim().toLowerCase();
    if (suffix === "view" || suffix === "edit") {
      const recipient = value.slice(0, cut).trim();
      if (recipient) return { recipient, access: suffix };
    }
  }
  return { recipient: value, access: "edit" };
};

/** "Davi <davi@example.com>", or whichever half of that exists. */
export const describeUser = (user) => {
  const name = String(user?.name ?? "").trim();
  const email = String(user?.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || String(user?.id ?? "unknown user");
};
