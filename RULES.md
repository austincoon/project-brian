# Game Rules

This document is the rules contract for the web game. The game engine and user interface must follow it unless this document is deliberately revised.

## 1. Players and board

- A game has two to four players.
- Players occupy fixed seats around the board.
- Each player has a distinct color, five marbles, five private Base positions, and five private Home positions.
- All five marbles begin in their owner's Base.
- The shared track has 48 positions arranged around the plus board, with five holes on every straight edge, and is traveled counterclockwise.
- A marble travels from its corner Start around the board to its colored Home entrance before entering its Home lane.
- Base and Home positions are private: opponents cannot enter them.

## 2. Dice

- The game uses two standard six-sided dice, rolled together with unbiased Web Crypto sampling.
- Each die is an independent movement value.
- The dice may move two different marbles or be used sequentially on the same marble, in either order.
- Each die must be used when it has a legal move; an unusable die is discarded after all chosen moves are resolved.
- A roll is doubles when both dice show the same value.
- Doubles grant the current player one additional turn after both dice are used or discarded.
- Doubles rolled during the opening high-roll do not grant another opening roll unless required to resolve a tie.

## 3. Choosing the first player

1. After the host starts the game, every player rolls both dice once. Players may make these opening rolls in any order.
2. The player with the highest total goes first.
3. If two or more players tie for the highest total, only those tied players roll again.
4. Tied highest players continue rerolling until one player has the highest total.
5. Normal play begins with that player and then proceeds clockwise by seat, regardless of the other opening-roll totals.

Opening rolls do not move marbles and do not use the normal doubles rule.

## 4. Turn sequence

On a normal turn:

1. The current player rolls both dice.
2. The game calculates every legal move for each unused die.
3. The player selects a marble and one highlighted destination available from either unused die; that move consumes the matching die.
4. If the other die still has a legal move, the player must complete that move, using either the same marble or another marble.
5. Any die with no legal move is discarded.
6. If the roll was doubles and the game has not been won, the same player takes another turn after both dice are resolved.
7. Otherwise, play advances clockwise to the next player.

A turn therefore always ends with exactly one of these outcomes:

- Both dice are used, followed by either another turn for doubles or the next player's turn.
- One die is used and the other has no legal move, followed by normal turn advancement.
- Neither die has a legal move, followed by normal turn advancement.
- Any die-action sends the fifth marble Home and ends the game immediately; the unused die is canceled.

## 5. Leaving Base

- A die showing 1 or 6 may move one marble from Base to Start.
- Leaving Base consumes only that die; the other die remains available.
- The other die may then move the newly released marble or another marble.
- Leaving Base is optional when that die has another legal move.
- A marble cannot leave Base when the player's own marble occupies Start.
- If an opponent occupies Start, a marble leaving Base may land there and return that opponent to its Base.
- Doubles still grant another turn after a marble leaves Base.

## 6. Moving on the track

- A track marble moves counterclockwise by exactly the selected die value.
- Every traversed position counts as one step unless the Gambit rules state otherwise.
- A marble may pass over an opponent's marble.
- A marble may not pass over or land on one of its owner's marbles.
- A move that cannot complete the selected die value is illegal.
- Only one marble may occupy a shared track position or the Gambit at a time.

## 7. Landing on an opponent

- If a marble ends its move on an opponent's marble, the opponent's marble is returned immediately to an open position in its owner's Base.
- The moving marble occupies the captured marble's former position.
- Capturing occurs only on the final position of a move; passing over an opponent does not capture it.
- Marbles in Base or Home cannot be captured.
- A marble occupying the Gambit can be captured.

## 8. The Gambit shortcut

- The center position is called the **Gambit**.
- The board has designated Gambit access positions connected to the center. Their exact coordinates and step distances are part of the board definition.
- Entering the Gambit is optional.
- A marked star shows a Gambit route but is not a counted board space.
- From the connected track access position, the Gambit center is one step away. From the preceding track position it is two steps away.
- After a 6 leaves Base, the other die may enter the Gambit immediately when it shows the exact 5 needed from Start.
- A marble may enter the Gambit only when the selected die lands exactly on the center position along a designated access route. It cannot enter with movement left over.
- Entering the Gambit ends that move.
- Only one marble may occupy the Gambit.
- If the player's own marble occupies it, another of their marbles cannot enter.
- If an opponent occupies it, an exact landing captures that marble and returns it to Base.
- On a later turn, a marble may leave the Gambit only with a die showing 1 or 6.
- Leaving consumes that die and places the marble on any one of the four corner access positions; it does not continue farther with that die.
- Normal blocking and capture rules apply while leaving the Gambit.
- Using the Gambit does not remove the requirement to reach the player's own Home entrance before entering Home.

There is no separate star-to-star shortcut. Any marked access positions exist only to enter or leave the Gambit.

## 9. Entering and moving within Home

- After reaching its colored Home entrance, a marble's route turns into its owner's Home lane.
- Once eligible to enter Home, the marble cannot continue past its Home entrance for another circuit.
- A marble must use the exact selected die value needed to reach a legal Home position. It cannot overshoot the end of the Home lane.
- Marbles continue to obey the rule against passing over or landing on the owner's other marbles inside Home.
- A marble already in Home may move farther into Home on a later turn when the exact movement is legal.
- Home marbles cannot return to the shared track.

## 10. No legal move

- The game recalculates legal moves after the roll and after the first die-action.
- An unused die with no legal move is discarded automatically.
- If neither die can be used, no marble moves.
- After both dice are used or discarded, doubles grant another turn; otherwise, play advances clockwise.
- The game must not wait for a player to select a move when no unused die has a legal move.

## 11. Host skip

- The host may skip the action currently owed by an abandoned or unavailable player.
- Skipping requires confirmation in the user interface.
- During the opening high-roll, a skip records no competitive roll for that player for the current opening round. That player cannot win that round but remains in the game.
- During normal play, a skip discards any unresolved roll and any extra turn earned by doubles, then advances clockwise.
- A skip never moves a marble and cannot declare a winner.
- The host cannot skip after the game has finished.
- The host may end an active game after confirmation. An ended game has no winner, accepts no further rolls or moves, and may be restarted by the host.

## 12. Winning

- A player wins immediately when all five of their marbles occupy their five Home positions.
- Any extra turn from doubles is canceled when the winning move is completed.
- No further rolls or moves are accepted after the game is finished.

## 13. Rule precedence

When rules interact, apply them in this order:

1. Reject actions made by anyone other than the player whose action is required.
2. Reject movement that does not use one available die's full value.
3. Reject movement blocked by the player's own marble.
4. Apply an opponent capture on the final position.
5. Check for victory.
6. If a usable die remains, continue the turn; otherwise grant the doubles turn or advance clockwise.
