export function createRepCounter() {
  let current = 0;

  return {
    next() {
      current += 1;
      return current;
    },
    reset() {
      current = 0;
    },
    get current() {
      return current;
    },
    set current(value: number) {
      current = value;
    },
  };
}
