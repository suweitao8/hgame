export function filterGames(games, query) {
  const keyword = String(query || '').trim().toLocaleLowerCase();
  if (!keyword) return games;
  return games.filter(game => game.name.toLocaleLowerCase().includes(keyword));
}
