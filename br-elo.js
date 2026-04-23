/**
 * br-elo.js — Battle Royale ELO Module
 *
 * Placement rules:
 *   - placement 1 = winner (best)
 *   - higher placement number = eliminated earlier (worse)
 *   - multiple players may share the same placement (tied)
 *   - placements do NOT need to be unique 1..N
 *
 * Minimum ranked lobby: 6 players. Smaller lobbies return eloChange = 0.
 */

const BRElo = (function () {

  // ── Constants ────────────────────────────────────────────────────────
  const MIN_LOBBY_SIZE = 6;
  const ELO_CLAMP_MIN  = -18;
  const ELO_CLAMP_MAX  = +18;
  const ELO_FLOOR      = 0;

  // ── K-factor ─────────────────────────────────────────────────────────
  // Returns the K-factor for a player based on their experience and ELO.
  //   K = 16  if playerElo >= 1600  (established high-rated player)
  //   K = 32  if gamesPlayed < 10   (provisional / new player)
  //   K = 24  otherwise             (standard)
  function kFactor(gamesPlayed, playerElo) {
    if (playerElo >= 1600) return 16;
    if (gamesPlayed < 10)  return 32;
    return 24;
  }

  // ── Actual score ──────────────────────────────────────────────────────
  // Converts a placement into a 0–1 score.
  // placement = 1 (winner)    → actual = 1.0
  // placement = lobbySize     → actual = 0.0
  // Tied players receive the same actual score.
  //
  // Formula: actual = (lobbySize - placement) / (lobbySize - 1)
  function actualScore(placement, lobbySize) {
    return (lobbySize - placement) / (lobbySize - 1);
  }

  // ── Expected score ────────────────────────────────────────────────────
  // Standard ELO expected score against a single average opponent.
  // avgOpponentsElo must EXCLUDE the current player.
  //
  // Formula: expected = 1 / (1 + 10 ^ ((avgOpponentsElo - playerElo) / 400))
  function expectedScore(playerElo, avgOpponentsElo) {
    return 1 / (1 + Math.pow(10, (avgOpponentsElo - playerElo) / 400));
  }

  // ── Validation ────────────────────────────────────────────────────────
  function validateEntry(entry, lobbySize) {
    if (typeof entry.eloRating !== 'number' || isNaN(entry.eloRating)) {
      throw new Error('BRElo: eloRating must be a number (got: ' + entry.eloRating + ')');
    }
    if (typeof entry.gamesPlayed !== 'number' || isNaN(entry.gamesPlayed) || entry.gamesPlayed < 0) {
      throw new Error('BRElo: gamesPlayed must be a non-negative number (got: ' + entry.gamesPlayed + ')');
    }
    if (typeof entry.placement !== 'number' || !Number.isInteger(entry.placement)) {
      throw new Error('BRElo: placement must be an integer (got: ' + entry.placement + ')');
    }
    if (entry.placement < 1) {
      throw new Error('BRElo: placement must be >= 1 (got: ' + entry.placement + ')');
    }
    if (entry.placement > lobbySize) {
      throw new Error(
        'BRElo: placement ' + entry.placement + ' exceeds lobbySize ' + lobbySize +
        '. Placement must be between 1 and lobbySize.'
      );
    }
  }

  // ── Single-player ELO calculation ────────────────────────────────────
  /**
   * Calculate the ELO change for one player.
   *
   * @param {object} params
   * @param {number} params.playerElo        - Current ELO rating
   * @param {number} params.gamesPlayed      - Ranked games played so far (for K-factor)
   * @param {number} params.placement        - Placement in this game (1 = winner; ties allowed)
   * @param {number} params.lobbySize        - Total number of players in the lobby
   * @param {number} params.avgOpponentsElo  - Average ELO of all OTHER players (excludes this player)
   *
   * @returns {{ eloChange: number, newElo: number, actual: number, expected: number, K: number }}
   */
  function calculateSinglePlayer(params) {
    var playerElo       = params.playerElo;
    var gamesPlayed     = params.gamesPlayed;
    var placement       = params.placement;
    var lobbySize       = params.lobbySize;
    var avgOpponentsElo = params.avgOpponentsElo;

    // Below minimum lobby size → no ELO change
    if (lobbySize < MIN_LOBBY_SIZE) {
      return {
        eloChange: 0,
        newElo:    playerElo,
        actual:    null,
        expected:  null,
        K:         null,
        reason:    'lobby_too_small',
      };
    }

    // Validate placement
    validateEntry(
      { eloRating: playerElo, gamesPlayed: gamesPlayed, placement: placement },
      lobbySize
    );

    var K        = kFactor(gamesPlayed, playerElo);
    var actual   = actualScore(placement, lobbySize);
    var expected = expectedScore(playerElo, avgOpponentsElo);

    // Raw change
    var raw = K * (actual - expected);

    // Clamp
    var clamped = Math.max(ELO_CLAMP_MIN, Math.min(ELO_CLAMP_MAX, raw));

    // Round to integer
    var eloChange = Math.round(clamped);

    // Apply floor so ELO never goes negative
    var newElo = Math.max(ELO_FLOOR, playerElo + eloChange);

    return {
      eloChange: eloChange,
      newElo:    newElo,
      actual:    actual,
      expected:  +expected.toFixed(4),
      K:         K,
    };
  }

  // ── Full-lobby ELO calculation ────────────────────────────────────────
  /**
   * Calculate ELO changes for every player in a lobby.
   *
   * Tied placements are fully supported — players sharing the same
   * placement receive the same `actual` score, but may receive different
   * `eloChange` values because each player's `expected` score is
   * computed against the average ELO of ALL OTHER players (excluding
   * themselves).
   *
   * @param {Array<{ playerId, eloRating, gamesPlayed, placement }>} players
   *   playerId    - any unique identifier (string or number)
   *   eloRating   - current ELO
   *   gamesPlayed - total ranked games played (for K-factor)
   *   placement   - placement in this game (1 = best; ties allowed; must be 1..lobbySize)
   *
   * @returns {Array<{ playerId, eloRating, gamesPlayed, placement,
   *                   avgOpponentsElo, eloChange, newElo, actual, expected, K }>}
   */
  function calculateLobby(players) {
    var lobbySize = players.length;

    // Below minimum → return unchanged entries
    if (lobbySize < MIN_LOBBY_SIZE) {
      return players.map(function (p) {
        return Object.assign({}, p, {
          avgOpponentsElo: null,
          eloChange:       0,
          newElo:          p.eloRating,
          actual:          null,
          expected:        null,
          K:               null,
          reason:          'lobby_too_small',
        });
      });
    }

    // Validate all entries before touching any ELO
    players.forEach(function (p) {
      validateEntry(p, lobbySize);
    });

    // Pre-compute total ELO for efficient per-player opponent average
    var totalElo = players.reduce(function (sum, p) { return sum + p.eloRating; }, 0);

    return players.map(function (p) {
      // Exclude this player from the opponent average
      var avgOpponentsElo = (totalElo - p.eloRating) / (lobbySize - 1);

      var result = calculateSinglePlayer({
        playerElo:       p.eloRating,
        gamesPlayed:     p.gamesPlayed,
        placement:       p.placement,
        lobbySize:       lobbySize,
        avgOpponentsElo: avgOpponentsElo,
      });

      return Object.assign({}, p, {
        avgOpponentsElo: +avgOpponentsElo.toFixed(1),
        eloChange:       result.eloChange,
        newElo:          result.newElo,
        actual:          result.actual,
        expected:        result.expected,
        K:               result.K,
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────
  return {
    calculateSinglePlayer: calculateSinglePlayer,
    calculateLobby:        calculateLobby,
    // Exposed for testing
    _kFactor:       kFactor,
    _actualScore:   actualScore,
    _expectedScore: expectedScore,
  };

}());

// Make available globally (matches Spontix's no-build plain-JS style)
if (typeof window !== 'undefined') window.BRElo = BRElo;
if (typeof module !== 'undefined') module.exports = BRElo;
