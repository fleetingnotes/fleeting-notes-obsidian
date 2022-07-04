#!/bin/bash
set -e
if [ -z "$1" ]
then
  echo "Please provide a version number (e.g. ./bumpversion.sh 1.2.3 )"
  # TODO: No argument supplied, so bump the patch version.
  # perl -i -pe 's/^(version:\s+\d+\.\d+\.\d+\+)(\d+)$/$1.($2+1)/e' pubspec.yaml
  # version=`grep 'version: ' pubspec.yaml | sed 's/version: //'`
else
  # Argument supplied, so bump to version specified
  sed -i '' 's|\(.*"version"\): "\(.*\)",.*|\1: '"\"$1\",|" package.json
  sed -i '' 's|\(.*"version"\): "\(.*\)",.*|\1: '"\"$1\",|" manifest.json
  npm i --package-lock-only
  version=$1
  git commit -m "Bump version to $version" package.json package-lock.json manifest.json
  git tag $version
fi
