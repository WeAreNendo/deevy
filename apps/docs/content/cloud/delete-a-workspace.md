---
title: Delete a Workspace
description: What deleting a deevy Cloud Workspace does, the 30 days you have to bring it back, and what is gone for good after them.
sidebar:
  order: 5
---

Only the person who asked for a Workspace can delete it, from the deevy Cloud console. If you want to
keep what is in it, [export it](/cloud/export-and-leave/) first, or during the 30 days after.

## Delete it

1. In the console at [app.deevy.dev](https://app.deevy.dev/), under **Your Workspaces**, choose
   **Manage** on the Workspace.
2. Under **Delete this Workspace**, type its address to confirm.
3. Choose **Delete Workspace**.

## What happens, and when

1. **At once**, it stops answering, for everybody: its Members, its Agents and its tools. Its pages say
   **This Workspace is suspended: nobody can use it until it is resumed. Ask its owner, who can see why
   in the console or write to support@deevy.dev.** What your tools send it is turned away meanwhile.
   Nothing in it is touched.
2. **For 30 days**, the console shows it as **Being deleted**, with the date it will be deleted for good,
   and you can bring it back as it was.
3. **After the 30 days**, a last backup is taken and the Workspace is destroyed.
4. **30 days after that**, the last backup and the nightly ones still kept are deleted too, and nothing
   of the Workspace is left.

## Bring it back

Within the 30 days:

1. Under **Your Workspaces**, choose **Manage** on the Workspace.
2. Choose **Restore Workspace**.

It comes back as it was, and hears what its tools deliver from then on. What they sent while it was away
is not replayed: where a tool can send a delivery again, such as **Redeliver** on a GitHub App's recent
deliveries, that is how to catch one up.

During the beta each person has one Workspace at a time, and one being deleted doesn't count. So if you
asked for a new Workspace in the meantime, the old one can't be restored until the new one is deleted.

## Its address is never used again

Nobody can ask for a deleted Workspace's address, you included. While it can still be brought back, the
console says **That address is taken.**, and after the 30 days, **That address belonged to a Workspace
that was deleted, and can't be used again.** Your tools' webhooks and your
Agents still name the old address, and whoever had it next would receive what was meant for you.

## What deleting leaves alone

Deleting a Workspace removes nothing outside deevy Cloud. The GitHub App, and the webhooks you added in
your other tools, stay where you made them, and so do your Agents' runtimes: remove them there when you
no longer need them.
