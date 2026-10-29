// seedrandom's core (the default ARC4 generator) without the extra
// generators its index.js adds; same function as `import "seedrandom"`.
declare module "seedrandom/seedrandom" {
  import seedrandom = require("seedrandom");
  export = seedrandom;
}
