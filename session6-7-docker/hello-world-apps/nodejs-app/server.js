const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.send("<h1>Hello World from Node.js and Docker</h1>");
});

app.listen(PORT, () => {
  console.log(`Node.js app running on port ${PORT}`);
});
