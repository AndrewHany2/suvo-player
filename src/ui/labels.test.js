import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LABELS } from "./labels.js";

describe("LABELS", () => {
  test("is frozen so drift can't be reintroduced by reassignment", () => {
    assert.equal(Object.isFrozen(LABELS), true);
  });

  test("canonical vocabulary values are locked", () => {
    assert.equal(LABELS.myList, "My List");
    assert.equal(LABELS.inMyList, "In My List");
    assert.equal(LABELS.addToMyList, "Add to My List");
    assert.equal(LABELS.removeFromMyList, "Remove from My List");
    assert.equal(LABELS.continueWatching, "Continue Watching");
    assert.equal(LABELS.home, "Home");
    assert.equal(LABELS.emptyTitle, "Your Home is ready");
    assert.equal(
      LABELS.emptyBody,
      "Play a movie, series, or channel and it appears here — and follows you to every device on your account. Browse Movies or Series to get started.",
    );
    assert.equal(LABELS.emptyCta, "Browse Movies");
    assert.equal(LABELS.noAccountTitle, "No account connected");
    assert.equal(LABELS.noAccountCta, "Connect account");
    assert.equal(LABELS.retry, "Retry");
  });
});
