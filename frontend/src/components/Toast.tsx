import React from "react";
import { useApp } from "../context/AppContext";

export default function Toast() {
  const { toastMsg } = useApp();
  return <div className={"toast" + (toastMsg ? " show" : "")}>{toastMsg}</div>;
}
