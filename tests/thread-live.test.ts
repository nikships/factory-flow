import assert from 'node:assert/strict';
import test from 'node:test';
import { liveStatus, readLiveScreen, readScreenStream, readScreenToolOutput, sameCommand, spinnerWorking, textSignature } from '../src/shared/thread-live.js';

// Droid 1.12.1 at 120x40 (Haiku 5.5, low effort), captured from its terminal: the logo rows above the
// conversation are trimmed.
const screen = (text: string) => text.replace(/^\n/, '').split('\n');

const EXECUTING = screen(`
                                 Skills (…)  MCPs (3) ✓  Connectors (1) ✓  AGENTS.md ✓


   Use the Execute tool to run exactly this command: for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done ; then reply
   with three short paragraphs about otters.

   Execute for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done
    ↳ tick 5

 ⠙ Executing...  (Press ESC to stop)

 Auto (High) · allow all commands                                                                       Haiku 5.5 (Low)
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ > Enter to steer · Ctrl+Enter to queue                                                                               │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
[⏱ 6s, context: 4%] ? for help                                                                             MCP ✗ | IDE ◌
/private/tmp/byte-live-probe
`);

const STREAMING = screen(`
   Use the Execute tool to run exactly this command: for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done ; then reply
   with three short paragraphs about otters.

   Execute for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done
    ↳ tick 1
      tick 2
      tick 3
      tick 4
    ... 2 more, Ctrl+O to view

⛬  Sea otters are among the few mammals that use tools. They crack open shellfish by balancing a rock on their chest
   and smashing the shell against it. Many keep a favorite stone in a loose pouch of skin under one foreleg.

   Otters also keep warm without blubber. Their fur is the densest of any animal, with up to around a million hairs
   per square inch. They trap air in that coat, and they groom constantly to keep it working. Because of this

 ⠰ Streaming...  (Press ESC to stop)

 Auto (High) · allow all commands                                                                       Haiku 5.5 (Low)
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ > Enter to steer · Ctrl+Enter to queue                                                                               │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
[⏱ 11s, context: 4%] ? for help                                                                            MCP ✗ | IDE ◌
/private/tmp/byte-live-probe
`);

const IDLE = screen(`
   Execute for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done
    ↳ tick 1
      tick 2
      tick 3
      tick 4
    ... 2 more, Ctrl+O to view

⛬  Sea otters are among the few mammals that use tools.

   Otters are playful and social.

 Auto (High) · allow all commands                                                                       Haiku 5.5 (Low)
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
[⏱ 11s, context: 5%] ? for help                                                                            MCP ✗ | IDE ◌
`);

test('a running command: the spinner, model and its output so far', () => {
  const live = readLiveScreen(EXECUTING);
  assert.equal(live.label, 'Executing...');
  assert.equal(live.working, 'executing_tool');
  assert.equal(live.model, 'Haiku 5.5 (Low)');
  assert.equal(live.transcript.at(-1), '    ↳ tick 5');
  const command = 'for i in 1 2 3 4 5 6; do echo tick $i; sleep 1; done';
  assert.deepEqual(
    readScreenToolOutput(live.transcript, 'Execute', (args) => sameCommand(args, command)),
    { output: 'tick 5' },
  );
  assert.equal(
    readScreenToolOutput(live.transcript, 'Execute', (args) => sameCommand(args, 'ls -la')),
    undefined,
  );
});

test('a message being written: its text so far, after the finished command', () => {
  const live = readLiveScreen(STREAMING);
  assert.equal(live.working, 'streaming_assistant_message');
  const stream = readScreenStream(live.transcript);
  assert.equal(stream?.kind, 'text');
  assert.match(stream?.text ?? '', /^Sea otters are among the few mammals that use tools\. They crack open shellfish by balancing a rock on their chest\nand smashing/);
  assert.match(stream?.text ?? '', /\n\nOtters also keep warm without blubber\..* Because of this$/s);
  assert.deepEqual(readScreenToolOutput(live.transcript, 'Execute'), { output: 'tick 1\ntick 2\ntick 3\ntick 4', more: 2 });
});

test('an idle screen has no spinner, and the stream reads the last message', () => {
  const live = readLiveScreen(IDLE);
  assert.equal(live.label, undefined);
  assert.equal(live.working, undefined);
  assert.equal(readScreenStream(live.transcript)?.text, 'Sea otters are among the few mammals that use tools.\n\nOtters are playful and social.');
});

test('a thought on screen reads as thinking', () => {
  const lines = ['⛬  Checking.', '', '   Thinking:', '   The user wants a list.', '   Five facts.', '', ' ⠙ Thinking...  (Press ESC to stop)', '', '╭────╮', '│ > │', '╰────╯'];
  const live = readLiveScreen(lines);
  assert.deepEqual(readScreenStream(live.transcript), { kind: 'thinking', text: 'The user wants a list.\nFive facts.' });
});

test('spinner words and statuses follow Factory', () => {
  assert.equal(spinnerWorking('Thinking...'), 'thinking');
  assert.equal(spinnerWorking('Planning 8 actions'), 'thinking');
  assert.equal(spinnerWorking('Invoking tools...'), 'executing_tool');
  assert.equal(spinnerWorking('Streaming...'), 'streaming_assistant_message');
  assert.equal(spinnerWorking('Compacting conversation...'), 'compacting_conversation');
  assert.equal(liveStatus('thinking'), 'pondering');
  assert.equal(liveStatus('executing_tool'), 'pondering');
  assert.equal(liveStatus('streaming_assistant_message'), 'responding');
  assert.equal(liveStatus('compacting_conversation'), 'compacting');
  assert.equal(liveStatus('waiting_for_tool_confirmation'), 'waiting');
  assert.equal(liveStatus('executing_tool', true), 'waiting');
  assert.equal(liveStatus('idle'), 'idle');
});

test('a screen without the input box is all transcript', () => {
  assert.deepEqual(readLiveScreen(['a', 'b']).transcript, ['a', 'b']);
  assert.equal(textSignature('**Sea** otters — 1 million!'), 'seaotters1million');
});
