import React from "react";

export function RaiseTooSmallCopy({ occupied }: { occupied: boolean }) {
  return (
    <main
      className="board"
      data-page="raise-too-small"
      data-occupied={occupied ? "true" : "false"}
    >
      <h1>{occupied ? "Raise is too small" : "No rank change"}</h1>
      {occupied ? (
        <p className="raise-too-small" data-raise-too-small="">
          The new bid must be at least $1 above the current bid. The original
          payer is charged only the difference, and the wall changes only after
          payment is confirmed.
        </p>
      ) : (
        <p>
          An incomplete or abandoned checkout stays off the wall and never
          becomes #1.
        </p>
      )}
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}
