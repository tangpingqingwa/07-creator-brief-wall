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
          New bid must be at least $1 above the current bid. Polar still charges only the difference, not a new full bid. Unpaid Polar checkout stays off the wall.
        </p>
      ) : (
        <p>
          Unpaid Polar checkout stays off the wall until Polar reports paid. An
          abandoned brief is not Terms as #1.
        </p>
      )}
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}
