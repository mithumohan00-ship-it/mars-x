import React from 'react';

export const FlashTransition = () => {
  return (
    <>
      <div id="flash">
        <div className="t1" id="flT1">
          ENTERING GALE CRATER
        </div>
        <div className="t2" id="flT2">
          DESCENT TO AEOLIS MONS · TERRAIN MODEL LOADING
        </div>
      </div>
      <div id="lock">
        <span>TARGET LOCK · GALE CRATER</span>
      </div>
    </>
  );
};
