# dash_dockview

A [Dash](https://dash.plotly.com/) component for the [dockview](https://dockview.dev/) layout manager.
It renders a tabbed, resizable, dockable panel layout, and it fills each panel with content that Dash renders.

The component is a generic renderer. It takes data down as props and sends events up as props.
It draws an icon, a badge, and a menu on each tab, but it never reads what they mean. The callbacks of your app read them.

It is built on `dockview-react` 8.6.1 (MIT). It works with Dash 2 and Dash 3.

## Install

Build the wheel (see [Build](#build)) and install it:

```bash
pip install dist/dash_dockview-0.1.2-py3-none-any.whl
```

## Quick start

```python
from dash import Dash, html
from dash_dockview import Dockview

app = Dash(__name__)
DV = "dv"

app.layout = html.Div(
    [
        Dockview(
            id=DV,
            height="500px",
            theme="dockview-theme-light",
            panels=[
                {"id": "a", "title": "Left"},
                {"id": "b", "title": "Right", "position": "right", "referencePanel": "a"},
            ],
        ),
        # The content of each panel. The component moves these divs into the panels.
        html.Div(
            [
                html.Div("Content of A", id=f"__dv_content_{DV}_a", style={"display": "none"}),
                html.Div("Content of B", id=f"__dv_content_{DV}_b", style={"display": "none"}),
            ]
        ),
    ]
)

if __name__ == "__main__":
    app.run(debug=True)
```

## Panel content

Dockview owns the DOM of a panel, and Dash owns the DOM of its components. The component joins the two with an id convention.

1. For each panel, render a `html.Div` with the id `__dv_content_{dockviewId}_{panelId}` anywhere in the Dash layout. Start it with `display: none`.
2. When dockview mounts the panel, the component moves that div into the panel and shows it.
3. When the panel closes, dockview disposes the panel DOM with the content div inside it. Remove the div from the Dash layout as well, and render a new one when you add the panel again.

Dockview mounts only the visible panel of a group. A panel in a background tab adopts its content when it becomes active.

## Props

### Input props (Python to JavaScript)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `str` | `"dockview"` | The component id. It is also the prefix of the content div ids. |
| `panels` | `list[PanelDef]` | `[]` | The panels. See [PanelDef](#paneldef). |
| `layout` | `dict \| None` | `None` | A layout from dockview's `toJSON()`. A new value restores it with `fromJSON()`. |
| `initialLayout` | `dict \| None` | `None` | A layout to load on the first mount only. |
| `layoutDebounceMs` | `int` | `250` | The delay before the component reports a layout change. |
| `width` | `str \| int` | `"100%"` | The width of the container. A number is pixels. |
| `height` | `str \| int` | `"100vh"` | The height of the container. A number is pixels. |
| `theme` | `str` | `"dockview-theme-abyss"` | A theme name. See [Themes](#themes). |
| `themeOverrides` | `dict[str, str]` | `{}` | CSS variables. See [Theme overrides](#theme-overrides). |
| `disableFloatingGroups` | `bool` | `False` | Disables floating groups. |

### Output props (JavaScript to Python)

| Prop | Type | Description |
| --- | --- | --- |
| `lastPanelAdded` | `dict` | `{panelId, title, groupId}` when a panel is added. |
| `lastPanelRemoved` | `dict` | `{panelId}` when a panel is removed. |
| `activePanel` | `dict` | `{panelId, groupId}` when the active panel changes. Both are `None` when no panel is active. |
| `openPanels` | `list[str]` | The ids of the open panels. Updated on each layout change, debounced. |
| `layout` | `dict` | The layout from `toJSON()`. Updated on each layout change, debounced. The component removes the tab fields from it before it reports it. |
| `lastTabMenuAction` | `dict` | `{panelId, itemId, at}` when the user picks an item in a tab menu. See [Tabs](#tabs). |

### PanelDef

```python
{
    "id": "unique-panel-id",       # Required.
    "title": "Panel title",        # Required.
    "position": "right",           # Optional: "right", "left", "above", "below", or "within".
    "referencePanel": "other-id",  # Optional. The panel that `position` refers to.
    "referenceGroup": "group-id",  # Optional. The group that `position` refers to.
    "icon": "/assets/chart.svg",   # Optional. An image URL drawn before the title.
    "badge": {"kind": "group", "label": "1"},            # Optional. See Tabs.
    "menu": [{"id": "leave", "label": "Leave group"}],   # Optional. See Tabs.
}
```

`"within"` adds the panel as a tab of the group of the reference panel. Without a reference the panel goes to the default position.

A new `panels` value adds the panels that are new and removes the panels that are gone.
A changed `icon`, `badge`, or `menu` repaints the tab in place. The panel is not added again, and `lastPanelAdded` does not fire.

## Tabs

The component draws its own tab. From left to right it draws the badge, the icon, the title, and a close button.

| Field | Shape | What the tab draws |
| --- | --- | --- |
| `icon` | an image URL | a 16 px image before the title |
| `badge` | `{"kind": "none"}`, `{"kind": "ungrouped"}`, or `{"kind": "group", "label": "1"}` | nothing, a dashed square, or a filled square with the label |
| `menu` | a list of `{"id", "label", "icon"}` with `icon` set to `"group"` or `"plus"`, or absent | the items of the menu that the badge opens |

An absent `badge` is `none`. A badge without `menu` items opens no menu.

When the user picks a menu item, the component sets `lastTabMenuAction` to `{panelId, itemId, at}`.
`itemId` is the `id` of the item, as you sent it. `at` is `Date.now()`, so two equal picks are two updates and each one fires a callback.

The close button shows on the active tab of each group, not only in the focused group.

The badge kinds follow a group model, in which a panel is in no group or in a named group.
The menu is generic, because the component never reads the item ids.

## Themes

`theme` is a name. Built-in names: `dockview-theme-abyss` (default), `dockview-theme-abyss-spaced`, `dockview-theme-light`, `dockview-theme-light-spaced`, `dockview-theme-dark`, `dockview-theme-dracula`, `dockview-theme-vs`.
Short names work too: `abyss`, `light`, `dark`, `dracula`, `vs`, `visual-studio`.

### Theme overrides

`themeOverrides` sets dockview CSS variables on the container. A key can be a bare name (`separator-border`), a `dv-` name, or a full `--dv-` name.
The dockview [theme documentation](https://dockview.dev/docs/overview/getStarted/theme) lists the variables.

```python
Dockview(
    id="dv",
    theme="dockview-theme-light",
    themeOverrides={
        "tabs-and-actions-container-height": "40px",
        "activegroup-visiblepanel-tab-background-color": "#FFFFFF",
        "activegroup-hiddenpanel-tab-background-color": "#EBEBEB",
    },
)
```

### Group focus marks

Dockview marks the focused group with `dv-active-group` and the other groups with `dv-inactive-group`.
The component adds four variables that draw a mark from these classes. Without them the marks draw nothing.

| Variable | Default | What it draws |
| --- | --- | --- |
| `activegroup-content-border` | `none` | the border of the content area, under the tab bar, of the focused group |
| `inactivegroup-content-border` | `none` | the same border for the other groups |
| `activegroup-visiblepanel-tab-underline-color` | `transparent` | a 2 px line at the bottom of the active tab of the focused group |
| `inactivegroup-visiblepanel-tab-underline-color` | `transparent` | the same line for the other groups |

Set the same border width on both groups. Then the content does not move when the focus changes.

```python
themeOverrides={
    "activegroup-content-border": "2px solid #7001C3",
    "inactivegroup-content-border": "2px solid #F1F1F1",
    "inactivegroup-visiblepanel-tab-underline-color": "#7001C3",
}
```

## Layout of this repository

- `src/ts/components/Dockview.tsx` is the component.
- `src/ts/components/PanelContent.tsx` moves the Dash content div into a panel.
- `src/ts/components/PanelTab.tsx` is the tab: badge, icon, title, and close button.
- `src/ts/components/TabMenu.tsx` is the menu that the badge opens.
- `src/ts/components/tabs.css` holds the tab styles. Every class name starts with `ddv-`.
- `src/ts/components/types.ts` holds the data shapes and the theme name table.
- `dash_dockview/` is the Python package. `npm run build` generates everything in it except `__init__.py`.
- `harness/` is a small Dash app and a Playwright driver for live checks in a browser.
- `scripts/build_wheel.sh` builds the bundle and the wheel.

## Build

```bash
PYTHON=/path/to/venv/bin/python scripts/build_wheel.sh
```

The script runs `npm ci`, `npm run build`, and `python -m build --wheel`. It writes the wheel to `dist/`.

`PYTHON` must have `dash`, `pyyaml`, `setuptools` (below version 81), and `build` installed.
The script runs `dash-generate-components` from the same `bin` folder.

`build:backends` ignores `PanelContent`, `PanelTab`, `TabMenu`, and `glyphs`. The Dash metadata extractor treats every `.tsx` file as a Dash component, and these files are not components.

## Checks

```bash
npm run typecheck
npm test
```

## Harness

The harness runs the component in a real browser. It needs the wheel installed in the Python that runs it.

```bash
python harness/app.py                       # serves http://127.0.0.1:8060
npx -y playwright@1.56.1 install chromium   # once
node harness/drive.mjs boot --out shots --measure
```

| Scenario | What it does |
| --- | --- |
| `boot`, `switch-tab`, `close-tab`, `set-layout`, `remove-panel`, `theme` | The panel, layout, and theme API. |
| `icons`, `dotted`, `group` | Measures the icon, the dashed badge, and the filled badge. `dotted` and `group` also read pixel colors. |
| `badge-menu` | Opens the menu, closes it with an outside click and with Escape, then chooses the second item. |
| `badge-drag` | Drags from the badge and from the title. Only the drag from the title moves the tab. |
| `active-close` | Applies a two-group layout. Checks that the tabs keep their icon and badge, and that the close button shows on the active tab of each group only. |
| `badge-update` | Clicks `flip-badge`. `--measure` prints the time from the click callback to the new badge. |
| `narrow` | Sets the viewport to 560 px wide and checks the overflow control. |
| `dump` | Prints the tab bar DOM and the last events. |

Each scenario saves a PNG to the `--out` folder and prints the `harness-events` entries that it reads.
If the pinned Chromium is not downloaded, set `PW_CHROMIUM_PATH` to another Chromium executable.
Set `HARNESS_PLAIN=1` when you start `harness/app.py` to leave out `icon`, `badge`, and `menu`.

## Notes

- `theme` stays a name string for Python. The component maps it to a dockview theme object.
- The `layout` prop does not carry the tab fields. Dockview writes panel params into its layout JSON, so the component removes them before it reports the layout. After a layout restore, the component sets the tab fields from the `panels` prop again.
- Dockview `api.isActive` is true only for the active panel of the active group. The tab reads `api.isVisible` instead, which is true for the active panel of each group.
- The badge stops `pointerdown` and `click`, and cancels `mousedown`. Without the first, a click on the badge of an inactive tab switches the tab. Without the last, a drag that starts on the badge moves the tab.
- The component renders the badge menu into `document.body`, because the tab bar clips its children.
- A layout restore with `fromJSON()` disposes the panels and their content divs. Render the content divs again after a restore, or the panels stay empty.

## License

MIT. See `LICENSE`.

The bundle includes code from dockview (MIT). See `dash_dockview/dash_dockview.js.LICENSE.txt` after a build.
The icons in `harness/assets` are from [Lucide](https://lucide.dev/) (ISC).
