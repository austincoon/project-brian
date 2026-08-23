export function rollDie(randomValues = crypto.getRandomValues.bind(crypto)) {
  const bytes = new Uint8Array(1);
  // 252 is divisible by six; rejecting 252–255 prevents modulo bias.
  do randomValues(bytes); while (bytes[0] >= 252);
  return bytes[0] % 6 + 1;
}

export function rollDice() {
  return [rollDie(), rollDie()];
}
