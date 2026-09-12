# Mesh on a Field, on a Stream Deck

Fifteen keys for the mesh planner's keyboard editor, as a Stream Deck profile of
hotkey actions with icons in the site's palette. The planner must be the front
window in the browser; each key sends one keystroke and the tool does the rest.

| Key | Sends | Does |
|---|---|---|
| Plan | 1 | plan view |
| 3D | 2 | 3D view |
| Left, Right, Up, Down | arrows | move the selected AP, obstacle, hill, crowd or client 1 m (hold Shift on the keyboard for 10 m) |
| Mast up, Mast down | ] and [ | mast height 0.5 m, or an obstacle's height, or a crowd's headcount |
| Turn left, Turn right | , and . | aim the antenna 5 degrees |
| Portal | P | make the selected AP the portal, or a point again |
| Fail | F | fail the selected AP, or bring it back |
| Next AP | Tab | select the next AP |
| Add AP | N | add an AP where the client stands |
| Heights | Shift+H | heights exaggeration up in 3D |

`mesh-on-a-field.streamDeckProfile` imports through the Stream Deck app (Preferences,
Profiles, the import arrow). The manifest follows the layout the desktop software
writes for a 15 key deck (Mk.2 model code); if a newer app refuses it, build the
keys by hand from `icons/*.png` and the table above: each is a System, Hotkey action.
Key codes are macOS virtual key codes; on Windows set the hotkeys again.
