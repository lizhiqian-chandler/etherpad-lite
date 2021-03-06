/**
 * The Group Manager provides functions to manage groups in the database
 */

/*
 * 2011 Peter 'Pita' Martischka (Primary Technology Ltd)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var customError = require("../utils/customError");
var randomString = require('ep_etherpad-lite/static/js/pad_utils').randomString;
var db = require("./DB");
var padManager = require("./PadManager");
var sessionManager = require("./SessionManager");

exports.listAllGroups = async function()
{
  let groups = await db.get("groups");
  groups = groups || {};

  let groupIDs = Object.keys(groups);
  return { groupIDs };
}

exports.deleteGroup = async function(groupID)
{
  let group = await db.get("group:" + groupID);

  // ensure group exists
  if (group == null) {
    // group does not exist
    throw new customError("groupID does not exist", "apierror");
  }

  // iterate through all pads of this group and delete them (in parallel)
  await Promise.all(Object.keys(group.pads).map(padID => {
    return padManager.getPad(padID).then(pad => pad.remove());
  }));

  // iterate through group2sessions and delete all sessions
  let group2sessions = await db.get("group2sessions:" + groupID);
  let sessions = group2sessions ? group2sessions.sessionsIDs : {};

  // loop through all sessions and delete them (in parallel)
  await Promise.all(Object.keys(sessions).map(session => {
    return sessionManager.deleteSession(session);
  }));

  // remove group and group2sessions entry
  await db.remove("group2sessions:" + groupID);
  await db.remove("group:" + groupID);

  // unlist the group
  let groups = await exports.listAllGroups();
  groups = groups ? groups.groupIDs : [];

  let index = groups.indexOf(groupID);

  if (index === -1) {
    // it's not listed

    return;
  }

  // remove from the list
  groups.splice(index, 1);

  // regenerate group list
  var newGroups = {};
  groups.forEach(group => newGroups[group] = 1);
  await db.set("groups", newGroups);
}

exports.doesGroupExist = async function(groupID)
{
  // try to get the group entry
  let group = await db.get("group:" + groupID);

  return (group != null);
}

exports.createGroup = async function()
{
  // search for non existing groupID
  var groupID = "g." + randomString(16);

  // create the group
  await db.set("group:" + groupID, {pads: {}});

  // list the group
  let groups = await exports.listAllGroups();
  groups = groups? groups.groupIDs : [];
  groups.push(groupID);

  // regenerate group list
  var newGroups = {};
  groups.forEach(group => newGroups[group] = 1);
  await db.set("groups", newGroups);

  return { groupID };
}

exports.createGroupIfNotExistsFor = async function(groupMapper)
{
  // ensure mapper is optional
  if (typeof groupMapper !== "string") {
    throw new customError("groupMapper is not a string", "apierror");
  }

  // try to get a group for this mapper
  let groupID = await db.get("mapper2group:" + groupMapper);

  if (groupID) {
    // there is a group for this mapper
    let exists = await exports.doesGroupExist(groupID);

    if (exists) return { groupID };
  }

  // hah, the returned group doesn't exist, let's create one
  let result = await exports.createGroup();

  // create the mapper entry for this group
  await db.set("mapper2group:" + groupMapper, result.groupID);

  return result;
}

exports.createGroupPad = async function(groupID, padName, text)
{
  // create the padID
  let padID = groupID + "$" + padName;

  // ensure group exists
  let groupExists = await exports.doesGroupExist(groupID);

  if (!groupExists) {
    throw new customError("groupID does not exist", "apierror");
  }

  // ensure pad doesn't exist already
  let padExists = await padManager.doesPadExists(padID);

  if (padExists) {
    // pad exists already
    throw new customError("padName does already exist", "apierror");
  }

  // create the pad
  await padManager.getPad(padID, text);

  //create an entry in the group for this pad
  await db.setSub("group:" + groupID, ["pads", padID], 1);

  return { padID };
}

exports.listPads = async function(groupID)
{
  let exists = await exports.doesGroupExist(groupID);

  // ensure the group exists
  if (!exists) {
    throw new customError("groupID does not exist", "apierror");
  }

  // group exists, let's get the pads
  let result = await db.getSub("group:" + groupID, ["pads"]);
  let padIDs = Object.keys(result);

  return { padIDs };
}
