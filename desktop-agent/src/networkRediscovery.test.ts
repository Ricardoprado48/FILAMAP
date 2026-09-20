import test from "node:test";
import assert from "node:assert/strict";

import { decideRediscovery } from "./networkRediscovery";

test("rediscovery: não inicia outra rotina se uma já está em andamento", () => {
  const result = decideRediscovery({
    rediscoveryInProgress: true,
    clientConnected: false,
    previousIp: "192.168.15.13",
    discoveredIp: "192.168.15.17",
  });

  assert.deepEqual(result, {
    action: "skip_in_progress",
    targetIp: "192.168.15.13",
  });
});

test("rediscovery: ignora resultado se MQTT já voltou a conectar", () => {
  const result = decideRediscovery({
    rediscoveryInProgress: false,
    clientConnected: true,
    previousIp: "192.168.15.13",
    discoveredIp: "192.168.15.17",
  });

  assert.deepEqual(result, {
    action: "skip_connected",
    targetIp: "192.168.15.13",
  });
});

test("rediscovery: ausência de IP gera nova tentativa", () => {
  const result = decideRediscovery({
    rediscoveryInProgress: false,
    clientConnected: false,
    previousIp: "192.168.15.13",
    discoveredIp: "",
  });

  assert.deepEqual(result, {
    action: "retry",
    targetIp: "192.168.15.13",
  });
});

test("rediscovery: mesmo IP pede reconexão sem alterar endereço", () => {
  const result = decideRediscovery({
    rediscoveryInProgress: false,
    clientConnected: false,
    previousIp: "192.168.15.17",
    discoveredIp: "192.168.15.17",
  });

  assert.deepEqual(result, {
    action: "reconnect_same_ip",
    targetIp: "192.168.15.17",
  });
});

test("rediscovery: novo IP pede atualização e reconexão", () => {
  const result = decideRediscovery({
    rediscoveryInProgress: false,
    clientConnected: false,
    previousIp: "192.168.15.13",
    discoveredIp: "192.168.15.17",
  });

  assert.deepEqual(result, {
    action: "reconnect_new_ip",
    targetIp: "192.168.15.17",
  });
});
