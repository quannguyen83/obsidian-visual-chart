# Obsidian Visual Charts

A lightweight experimental Obsidian plugin for interactive, raised SVG pie charts in Markdown code blocks.

## Install manually

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<Vault>/.obsidian/plugins/visual-charts/
```

Enable **Visual Charts** in Obsidian → Settings → Community plugins. Reload or toggle the plugin after updating.

## Usage

````markdown
```visual-chart
type: pie-3d
title: IT Project Outcomes – CHAOS Report 2009
depth: 10
explode: 6
hover: 8
data:
  Successful: 32
  Resource overruns: 44
  No result: 24
```
````

`depth` controls the raised effect, `explode` separates the slices (`0` for touching slices), and `hover` controls lift in pixels. Data must contain 2–16 positive numeric values.

## Current features

- Circular SVG pie slices with a colored raised/shadow effect
- Hover lift and keyboard focus
- Accessible slice labels and custom floating tooltip (category, percentage, original value)
- Theme-aware legend and tooltip
- No third-party runtime libraries

This is an early local prototype, not an official Obsidian community release. The `tilt` input is currently reserved; rendering stays circular/top-down.

## Venn diagram (World / Machine example)

Use the editable SVG Venn renderer in a note:

````markdown
```visual-chart
type: venn
style: raised
depth: 8
title: Requirements are about the real world.
environment: Environment|real world
system: System
phenomena: Phenomena of|the real world
shared: Shared|phenomena
sensors: Sensors and|actuators
requirement: The reverse thrust shall be enabled if and only if the aircraft is on ground.
knowledge: If the aircraft is on ground, wheel rotation impulses exceed x per sec.
specification: The reverse thrust shall be enabled if and only if wheel rotation impulses exceed x per sec.
```
````

Each field is optional. Use `|` to insert a manual line break in diagram labels. The SVG remains theme-aware and scales to the note width, with horizontal scrolling on narrower screens.

Venn supports `style: flat` (default) or `style: raised`, with a configurable `depth` (0–14px) for layered ellipses and raised cards.
