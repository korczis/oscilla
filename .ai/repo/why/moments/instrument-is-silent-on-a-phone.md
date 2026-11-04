---
schema: moment/v1
id: instrument-is-silent-on-a-phone
kind: moment
title: 'An instrument that is silent on a phone'
short_title: 'Silent on a phone'
hook: 'opened a sound lab on a phone, pressed play and heard nothing, while the same page sounded on a laptop'
summary: 'A browser plays Web Audio only after a user gesture it recognises, and iOS mutes it at the ringer switch unless the page asks for a playback session; a page that unlocks audio on the wrong event, or never asks, is silent on a phone, and a test browser launched with the gesture rule off cannot see it.'
status: stable
severity: high
frequency: common
weight: 15
audiences: [students, teachers, audio-hobbyists, maintainers]
areas: [playback-safety, delivery]
lifecycle: [operations, maintenance, review]
tags: [mobile, ios, autoplay, user-gesture, audio-session]
signals:
  - id: silent-on-the-phone
    text: 'A tone or a key played on a desktop and made no sound on a phone.'
  - id: ringer-switch
    text: 'An iPhone stayed silent with its ringer switch on mute, although the media volume was up.'
  - id: green-gate-silent-page
    text: 'Every browser test passed while the page made no sound for a person on a touch screen.'
examples:
  - id: owner-report
    audience: audio-hobbyists
    title: 'The owner plays it on a phone'
    before: 'On 2026-11-02 the owner reported "on the phone it makes no sound; this must not happen": the page unlocked audio only at pointerdown, while a touch grants a user activation only at its end, and it never asked iOS for a playback audio session.'
    after: 'The unlock listens at pointerdown, keydown, pointerup and touchend (never a bare click), and the page sets navigator.audioSession.type to playback where the API exists (#384).'
  - id: classroom-phones
    audience: students
    title: 'A class follows on their own phones'
    before: 'Half the class hears the tone the teacher plays and the other half, on iPhones with the ringer muted, hears nothing and concludes the page is broken.'
    after: 'The page asks for a playback session, so Web Audio plays through the ringer switch as a media app does, and the first tap starts audio.'
  - id: gate-with-the-rule-off
    audience: maintainers
    title: 'A gate that switched the rule off'
    before: 'Every browser suite launched Chromium with --autoplay-policy=no-user-gesture-required, so no test could see a page that never unlocked audio, and none stood in for navigator.audioSession.'
    after: 'tests/browser/touch-audio.cjs launches Chromium with the gesture rule on, stands in for the audio session and is a GATE suite that rule project.a-phone-sounds keeps in test:browser (#387).'
claims: [phone-audio-unlocks]
doctrines: [project.a-phone-sounds, project.audio-engine-discipline]
use_cases: [play-a-440-hz-tone]
related: [test-tone-blasts-or-clicks, page-breaks-offline-or-on-a-sub-path]
aliases: ['no sound on iPhone', 'autoplay blocked', 'ringer switch mutes web audio', 'phone silent']
---

## The moment

The page sounds on a laptop. On a phone the same page shows the same controls, the tone is
"playing" and nothing comes out of the speaker. On an iPhone it stays silent with the ringer
switch on mute even though the media volume is up.

## Why it happens

A browser lets a page start audio only inside a user activation. A mouse button and a key
grant it when they go down, but the HTML standard grants it for a touch only when the touch
ends, so a page that unlocks audio at pointerdown alone never unlocks on a touch screen. iOS
(Safari 17+) also mutes Web Audio at the ringer switch unless the page asks for a playback
audio session through `navigator.audioSession`. And a gate that launches its browsers with the
gesture rule switched off cannot see either cause.

## What it costs

For many people a phone is the first screen they open the instrument on. Silence there is the
whole product failing: the reader concludes the page is broken and leaves, and a class
following on its phones splits into those who hear and those who do not.

## What OSCILLA does

`src/js/ui/audio-unlock.js` is the one place the unlock is armed: in the capture phase at
pointerdown, keydown, pointerup and touchend, never at a bare click, and it sets the audio
session's type to `playback` where the API exists (rule `project.a-phone-sounds`, from the
owner's report of 2026-11-02; fix #384, rule #387).

## How to verify it

`npm test` runs `tests/unit/audio-unlock.test.mjs` (the unlock events, the capture phase, no
click, the session set, absent and refused) and `tests/unit/rule-a-phone-sounds.test.mjs` (the
suite stays in `test:browser` with the gesture rule on). `npm run test:browser` runs
`tests/browser/touch-audio.cjs` in three browsers, with checks `audio-session-playback` and
`tap-unlocks-audio`.

## What it does not do

No check uses a real iPhone's ringer switch or a real touch screen: the suites stand in for
both. The first key tap of a session is a known limit until the engine replays a note held
across the unlock.
