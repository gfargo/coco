import fs from "fs";

//Reach the package.json file
export function getPackageJson() {
  const path = `${process.cwd()}/package.json`;
  const packageData = JSON.parse(fs.readFileSync(path, "utf8"));
  return packageData;
}
