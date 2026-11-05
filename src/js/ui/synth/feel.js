// The synth-theme layer's control feel (plan K058, slice S3 "knob and fader feel"), since slice S
// a thin re-export: the gestures moved into the control family's neutral knob model
// (src/js/ui/controls/knob-model.js) and a fader's press into its slider model
// (slider-model.js), so a skin of any look shares them. This module keeps every name its
// importers use (src/js/synth/gestures.js and the tests), the same functions, not copies; new
// code imports the models. It adds no listener and reads no document (K153).
//
//   dragAnchor, reanchorDrag, dragAt           a drag measured from an anchor (knob model)
//   gestureOf, cancelGesture, GESTURE_IDLE_MS  one undo entry per gesture (knob model)
//   faderPress                                 a press on a fader (slider model)

export {
  cancelGesture, dragAnchor, dragAt, GESTURE_IDLE_MS, gestureOf, reanchorDrag,
} from '../controls/knob-model.js';
export { faderPress } from '../controls/slider-model.js';
