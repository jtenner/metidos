import { BrowserWindow } from "electrobun/bun";

new BrowserWindow({
  title: "jt-ide",
  frame: {
    width: 960,
    height: 640,
    x: 100,
    y: 100,
  },
  url: "views://mainview/index.html",
});
