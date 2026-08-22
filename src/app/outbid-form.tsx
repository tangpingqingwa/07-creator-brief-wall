import { MIN_BID_USD } from "../lib/rank";

export function OutbidForm() {
  return (
    <form className="outbid-form" method="post" action="/checkout">
      <label className="brand">
        Brand
        <input name="brand" type="text" required maxLength={80} autoComplete="organization" />
      </label>
      <label className="terms">
        Terms
        <input
          name="terms"
          type="text"
          required
          maxLength={280}
          placeholder="$800 flat, 1 TikTok"
        />
      </label>
      <label className="url">
        Brief URL
        <input
          name="briefUrl"
          type="url"
          required
          placeholder="https://"
          autoComplete="url"
        />
      </label>
      <label className="amount">
        Amount
        <input
          name="bidUsd"
          type="number"
          required
          min={MIN_BID_USD}
          max={50000}
          step={1}
          defaultValue={MIN_BID_USD}
        />
      </label>
      <button className="outbid" type="submit">
        Outbid
      </button>
    </form>
  );
}
