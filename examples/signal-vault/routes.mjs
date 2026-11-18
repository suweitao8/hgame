const directions = { U: 'up', D: 'down', L: 'left', R: 'right' };

export const solutions = ['RDRRR', 'UUURDLDRRRRDRRULUR', 'RRRRURURRDDLUUDRR'].map(
  sequence => Array.from(sequence, letter => directions[letter]),
);
