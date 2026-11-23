---
title: Sign in to your Workspace
description: Sign in to a deevy Cloud Workspace with GitHub or Google, move between Workspaces, and sign out.
sidebar:
  order: 2
---

Your Workspace signs its own Members in. Being signed in to deevy Cloud, where you asked for the
Workspace, doesn't sign you in to it, and being signed in to one Workspace doesn't sign you in to
another.

## Sign in

1. Go to your Workspace's address: `app.deevy.dev/` followed by its address, such as
   `https://app.deevy.dev/acme`.
2. Choose **Continue with GitHub** or **Continue with Google**, and finish signing in there.

You land on **Needs me**, the page of what is waiting on you.

On this browser, the way you signed in last time comes first and is marked **Last used**. deevy
remembers it in a cookie that holds nothing but the provider's name.

### GitHub or Google

Either works, and both lead to the same Member as long as they carry the same email address. As long as
GitHub and Google have both confirmed that address, signing in with Google one day and GitHub the next is
still you. Two different addresses are two different Humans, so sign in on the address your Workspace
knows you by.

Signing in with GitHub asks only who you are and the addresses you confirmed there.

## If you can't get in

- **Signed in, not yet a Member**: deevy knows who you are, but nobody has let you in yet. Ask an admin
  of the Workspace to invite you, or to add your email domain under **Who may join**, then sign in
  again.
- **You have an invitation waiting**: you came from an invitation link. Sign in with the address it was
  sent to. If you sign in with another, deevy says **That invitation is not yours yet** and names the
  address it was for; choose **Sign out and try another account**.
- **Your membership is suspended**: an admin has paused your access. They can reinstate you at any
  time.
- **This Workspace is suspended: nobody can use it until it is resumed. Ask its owner, who can see why in
  the console or write to support@deevy.dev.**: the whole Workspace is paused, or is being deleted
  ([Delete a Workspace](/cloud/delete-a-workspace/)).

## More than one Workspace

Each Workspace has its own Members, so you join each one separately, by its own invitation or rule. Its
sessions are its own too: you can be signed in to several at once, in tabs side by side, and signing out
of one leaves the others as they are.

To move between them, go to each one's address, and bookmark the ones you use. The Workspaces you asked
for yourself are also listed in the deevy Cloud console at [app.deevy.dev](https://app.deevy.dev/), under
**Your Workspaces**: **Open** takes you to one, and **Manage** to its page in the console.

## Sign out

In your Workspace, open the menu under your name at the bottom of the sidebar and choose **Sign out**.
That signs you out of this Workspace only.

To sign out of the deevy Cloud console, open **Account** (your name, at the top right of the console) and
choose **Sign out**.

## Next

- [Invite your team](/get-started/invite-your-team/).
