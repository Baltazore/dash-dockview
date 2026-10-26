"""Harness for the dash_dockview component. Run: python harness/app.py (port 8060, or HARNESS_PORT)."""

import json
import os
from pathlib import Path

from dash import Dash, Input, Output, State, dcc, html, no_update
from dash_dockview import Dockview

DOCKVIEW_ID = "dv"
PORT = int(os.environ.get("HARNESS_PORT", "8060"))

PANEL_TITLES = {
    "p1": "Line chart",
    "p2": "Table",
    "p3": "Table",
    "p4": "Box plot",
}

# HARNESS_PLAIN=1 leaves out icon, badge, and menu, to compare with a build that has no tab model.
PLAIN = os.environ.get("HARNESS_PLAIN") == "1"

TAB_MENU = [
    {"id": "create", "label": "Create group", "icon": "plus"},
    {"id": "join:1:group", "label": "Join group 1", "icon": "group"},
    {"id": "leave", "label": "Leave group"},
]

TAB_FIELDS = {
    "p1": {"icon": "/assets/chart-line.svg", "badge": {"kind": "ungrouped"}},
    "p2": {"icon": "/assets/table.svg", "badge": {"kind": "ungrouped"}},
    "p3": {"icon": "/assets/table.svg", "badge": {"kind": "group", "label": "1"}},
    "p4": {"icon": "/assets/box-plot.svg", "badge": {"kind": "group", "label": "1"}},
}

FLIPPED_BADGE = {"kind": "group", "label": "2"}


def tab_fields(panel_id: str) -> dict:
    return {} if PLAIN else {**TAB_FIELDS[panel_id], "menu": TAB_MENU}


# A 2x2 grid. Dockview mounts only the visible panel of a group, so one group
# per panel is the way to get all four content divs adopted at once.
PANELS = [
    {"id": "p1", "title": PANEL_TITLES["p1"], **tab_fields("p1")},
    {"id": "p2", "title": PANEL_TITLES["p2"], "position": "right", "referencePanel": "p1", **tab_fields("p2")},
    {"id": "p3", "title": PANEL_TITLES["p3"], "position": "below", "referencePanel": "p1", **tab_fields("p3")},
    {"id": "p4", "title": PANEL_TITLES["p4"], "position": "below", "referencePanel": "p2", **tab_fields("p4")},
]

# The same panels with the first badge changed. Only the badge differs, so the update is a pure badge flip.
FLIPPED_PANELS = [{**PANELS[0], "badge": FLIPPED_BADGE}, *PANELS[1:]]

TWO_GROUP_LAYOUT = json.loads((Path(__file__).parent / "two_group_layout.json").read_text())

OUTPUT_PROPS = [
    "activePanel",
    "lastPanelAdded",
    "lastPanelRemoved",
    "openPanels",
    "layout",
    "lastTabMenuAction",
]

THEME_OVERRIDES = {
    "separator-border": "#ff0000",
    "dv-sash-color": "#00aa00",
    "--dv-active-sash-color": "#0000ff",
}

RECORD_EVENTS_JS = """
function() {
    const events = arguments[arguments.length - 1] || [];
    const now = Date.now();
    const triggered = window.dash_clientside.callback_context.triggered;
    const added = triggered.map((t) => ({
        prop: t.prop_id.split('.')[1],
        value: t.value === undefined ? null : t.value,
        at: now,
    }));
    const next = events.concat(added);
    window.__harnessEvents = next;
    return next;
}
"""

MARK_SET_LAYOUT_JS = """
function(clicks, events) {
    const next = (events || []).concat([{prop: 'set-layout-clicked', value: clicks, at: Date.now()}]);
    window.__harnessEvents = next;
    return next;
}
"""

# A MutationObserver gives the mark the time of the DOM change, not of the next poll.
MARK_ADOPTED_JS = """
function(ticks, dockviewId, panelIds) {
    if (window.__panelsAdoptedWatch) {
        return window.performance.getEntriesByName('panels-adopted').length ? 'adopted' : 'waiting';
    }
    const check = () => {
        const root = document.querySelector('#' + dockviewId + ' .dv-dockview');
        if (!root || window.performance.getEntriesByName('panels-adopted').length) return;
        const adopted = panelIds.every((panelId) => {
            const content = document.getElementById('__dv_content_' + dockviewId + '_' + panelId);
            return content && root.contains(content);
        });
        if (adopted) {
            window.performance.mark('panels-adopted');
            window.__panelsAdoptedWatch.disconnect();
        }
    };
    window.__panelsAdoptedWatch = new MutationObserver(check);
    window.__panelsAdoptedWatch.observe(document.body, {childList: true, subtree: true});
    check();
    return 'waiting';
}
"""


FLIP_BADGE_JS = """
function(clicks, flippedPanels) {
    window.performance.mark('flip-badge-clicked');
    return flippedPanels;
}
"""

# Marks the first DOM change that shows the new badge. The mark comes before the paint of that frame.
MARK_BADGE_JS = """
function(ticks, dockviewId, panelIds) {
    if (window.__badgeUpdatedWatch) {
        return window.performance.getEntriesByName('badge-updated').length ? 'updated' : 'watching';
    }
    const check = () => {
        if (window.performance.getEntriesByName('badge-updated').length) return;
        const badge = document.querySelector(
            '#' + dockviewId + ' .dv-tab[data-tab-panel-id="' + panelIds[0] + '"] .ddv-badge--group'
        );
        if (badge && badge.textContent.trim() === '2') {
            window.performance.mark('badge-updated');
            window.__badgeUpdatedWatch.disconnect();
        }
    };
    window.__badgeUpdatedWatch = new MutationObserver(check);
    window.__badgeUpdatedWatch.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true});
    check();
    return 'watching';
}
"""


def build_app() -> Dash:
    app = Dash(__name__)
    app.layout = html.Div(
        [
            html.Div(
                [
                    html.Button("set-layout", id="set-layout"),
                    html.Button("remove-panel", id="remove-panel"),
                    html.Button("apply-theme", id="apply-theme"),
                    html.Button("flip-badge", id="flip-badge"),
                    html.Span(id="adopt-status", style={"marginLeft": "12px"}),
                    html.Span(id="badge-status", style={"marginLeft": "12px"}),
                ],
                style={"padding": "6px"},
            ),
            Dockview(
                id=DOCKVIEW_ID,
                height="600px",
                width="100%",
                theme="dockview-theme-light",
                panels=PANELS,
            ),
            html.Div(
                id="dockview-content-container",
                children=[
                    html.Div(
                        id=f"__dv_content_{DOCKVIEW_ID}_{panel_id}",
                        style={"display": "none"},
                        children=[
                            html.H3(f"Content of {title}"),
                            html.P(f"This is the adopted content for {panel_id}."),
                        ],
                    )
                    for panel_id, title in PANEL_TITLES.items()
                ],
            ),
            dcc.Store(id="harness-events", data=[]),
            dcc.Store(id="harness-panel-ids", data=list(PANEL_TITLES)),
            dcc.Store(id="harness-dockview-id", data=DOCKVIEW_ID),
            dcc.Store(id="harness-flipped-panels", data=FLIPPED_PANELS),
            dcc.Interval(id="adopt-tick", interval=25, max_intervals=40),
        ]
    )

    app.clientside_callback(
        RECORD_EVENTS_JS,
        Output("harness-events", "data"),
        *[Input(DOCKVIEW_ID, prop) for prop in OUTPUT_PROPS],
        State("harness-events", "data"),
        prevent_initial_call=True,
    )
    app.clientside_callback(
        MARK_SET_LAYOUT_JS,
        Output("harness-events", "data", allow_duplicate=True),
        Input("set-layout", "n_clicks"),
        State("harness-events", "data"),
        prevent_initial_call=True,
    )
    app.clientside_callback(
        MARK_ADOPTED_JS,
        Output("adopt-status", "children"),
        Input("adopt-tick", "n_intervals"),
        State("harness-dockview-id", "data"),
        State("harness-panel-ids", "data"),
    )

    app.clientside_callback(
        MARK_BADGE_JS,
        Output("badge-status", "children"),
        Input("adopt-tick", "n_intervals"),
        State("harness-dockview-id", "data"),
        State("harness-panel-ids", "data"),
    )
    app.clientside_callback(
        FLIP_BADGE_JS,
        Output(DOCKVIEW_ID, "panels", allow_duplicate=True),
        Input("flip-badge", "n_clicks"),
        State("harness-flipped-panels", "data"),
        prevent_initial_call=True,
    )

    @app.callback(
        Output(DOCKVIEW_ID, "layout"),
        Input("set-layout", "n_clicks"),
        prevent_initial_call=True,
    )
    def set_layout(_clicks):
        return TWO_GROUP_LAYOUT

    @app.callback(
        Output(DOCKVIEW_ID, "panels"),
        Input("remove-panel", "n_clicks"),
        prevent_initial_call=True,
    )
    def remove_second_panel(_clicks):
        return [panel for panel in PANELS if panel["id"] != PANELS[1]["id"]]

    @app.callback(
        Output(DOCKVIEW_ID, "theme"),
        Output(DOCKVIEW_ID, "themeOverrides"),
        Input("apply-theme", "n_clicks"),
        prevent_initial_call=True,
    )
    def apply_theme(_clicks):
        return "dockview-theme-abyss", THEME_OVERRIDES

    return app


if __name__ == "__main__":
    build_app().run(host="127.0.0.1", port=PORT, debug=False)
