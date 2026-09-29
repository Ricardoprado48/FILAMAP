import test from "node:test";
import assert from "node:assert/strict";
import { printerModelFromSerial } from "./printerModel";

test("modelo pelo prefixo do serial", () => {
  assert.equal(printerModelFromSerial("03919D570307088"), "A1");
  assert.equal(printerModelFromSerial("0300AA000000000"), "A1 mini");
  assert.equal(printerModelFromSerial("01P00A000000000"), "P1S");
  assert.equal(printerModelFromSerial("01S00A000000000"), "P1P");
  assert.equal(printerModelFromSerial("00M09A000000000"), "X1 Carbon");
  assert.equal(printerModelFromSerial(" 01p00a000000000 "), "P1S");
});

test("serial desconhecido ou vazio não inventa modelo", () => {
  assert.equal(printerModelFromSerial("ZZZ123"), null);
  assert.equal(printerModelFromSerial(""), null);
  assert.equal(printerModelFromSerial(null), null);
  assert.equal(printerModelFromSerial("03"), null);
});
