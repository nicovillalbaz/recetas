import { Suspense } from "react";
import PrescriptionApp from "./components/PrescriptionApp";

export default function Home() {
  return (
    <Suspense>
      <PrescriptionApp />
    </Suspense>
  );
}
