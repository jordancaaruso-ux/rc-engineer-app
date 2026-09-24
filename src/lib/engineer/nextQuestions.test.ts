import test from "node:test";
import assert from "node:assert/strict";
import {
  holdBackNextQuestions,
  NEXT_QUESTIONS_MAX,
  OTHER_OPTIONS_LABEL,
  OTHER_OPTIONS_QUESTION,
  splitNextQuestions,
} from "./nextQuestions";

test("the next line becomes buttons and leaves the text", () => {
  const reply =
    "Try **one step softer on the front anti-roll bar**. It may make turn-in gentler.\n\n[[next: What if turn-in gets worse? | What about the rear toe? | How do I test it?]]";
  const { text, nextQuestions } = splitNextQuestions(reply);
  assert.equal(text, "Try **one step softer on the front anti-roll bar**. It may make turn-in gentler.");
  assert.deepEqual(nextQuestions, ["What if turn-in gets worse?", "What about the rear toe?", "How do I test it?"]);
});

test("a line mid-reply is cut too, with the prose either side kept", () => {
  const reply = "First paragraph.\n\n[[next: A | B]]\n\nCorrection — something the guard added.";
  const { text, nextQuestions } = splitNextQuestions(reply);
  assert.equal(text, "First paragraph.\n\nCorrection — something the guard added.");
  assert.deepEqual(nextQuestions, ["A", "B"]);
});

test("no line, no buttons, text untouched; an unclosed line is dropped, never shown", () => {
  assert.deepEqual(splitNextQuestions("Just an answer."), { text: "Just an answer.", nextQuestions: [] });
  assert.deepEqual(splitNextQuestions("An answer.\n[[next: What if it"), { text: "An answer.", nextQuestions: [] });
});

test("the app's own button is never repeated, blanks and duplicates go, and three is the most", () => {
  const reply = `x\n[[next: ${OTHER_OPTIONS_LABEL} | ${OTHER_OPTIONS_QUESTION} |  | One | one | Two | Three | Four ]]`;
  const { nextQuestions } = splitNextQuestions(reply);
  assert.deepEqual(nextQuestions, ["One", "Two", "Three"]);
  assert.equal(nextQuestions.length, NEXT_QUESTIONS_MAX);
});

test("a button that is really prose is dropped", () => {
  const long = "What would happen if I changed the front and the rear at the same time on a low grip day with old tyres";
  assert.deepEqual(splitNextQuestions(`x\n[[next: ${long} | Short one?]]`).nextQuestions, ["Short one?"]);
});

test("the stream never shows the marker, however the tokens split it", () => {
  const reply = "Soften the bar [one step].\n\n[[next: A | B]]";
  for (let size = 1; size <= 6; size++) {
    let shown = "";
    const sink = holdBackNextQuestions((t) => (shown += t));
    for (let i = 0; i < reply.length; i += size) sink.push(reply.slice(i, i + size));
    sink.flush();
    assert.equal(shown.trim(), "Soften the bar [one step].", `token size ${size}`);
  }
});

test("a held-back bracket that never became the marker is released at the end", () => {
  let shown = "";
  const sink = holdBackNextQuestions((t) => (shown += t));
  sink.push("Ends with a bracket [");
  assert.equal(shown, "Ends with a bracket ");
  sink.flush();
  assert.equal(shown, "Ends with a bracket [");
});
