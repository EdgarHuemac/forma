# forma

Write a word, and watch it grow from the center of the page into forms.
This application was inspired by my recent lecture of [House of Leaves](https://en.wikipedia.org/wiki/House_of_Leaves), and by [ergodic literature](http://en.wikipedia.org/wiki/Ergodic_literature) in general.


## Tuning

just play with it and find out he he


## Customize

- Add more shapes: write a new `(t) => {x, y}` function in `script.js` next
  to `circlePoint` / `heartPoint`, add it to the `SHAPES` map, and add a
  button in `index.html`.
- Add more typefaces: add a Google Fonts `@family` to the `<link>` in
  `index.html`, and add matching `<option>` / `FONTS` entries.
